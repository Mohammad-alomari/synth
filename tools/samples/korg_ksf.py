#!/usr/bin/env python3
"""Korg sample files read directly: KSC (list of multisamples), KMP (key zones), KSF (one sample), with Korg's
8-bit compressed samples decoded. Writes the folder pack.py takes (--sf-zones): one WAV per sample + zones.json.

File layouts: Korg's "About KORG format files" (Triton parameter guide appendix). The compressed sample format is
not documented by Korg; the decoder below was measured on KORG Collection TRINITY (the same bytes played by the
plugin, dry, at their original pitch; research/trinity/REPORT.md):

  one signed byte b per sample;  step = sign(b) * (2^(|b|/16) - 1) * SCALE
  y[n] = c1 * y[n-1] + c2 * y[n-2] + step[n]        (c1, c2: fixed per compression ID, whatever the sample rate)

Compression IDs 0-2 are known to four decimals, 3-5 less well (their second pole to about +-0.05: up to about
half a dB at the top of the band). A KMP zone's level byte is not used (the plugin ignores it), its tune is cents.
A sample loops from its loop address to its end address, and the end sample stands for the loop sample
(measured: the loop is end - loop frames long).

Nothing here is Korg's: no code, no table, no sample. What it reads stays on your disk.
"""
import json
import os
import struct

import numpy as np
from scipy import signal

SCALE = 128.0  # sixteen-bit units per table unit (measured 125-126.5 against a 16-bit zone of the same program)


def _polar(r, deg):
    return 2 * r * np.cos(np.radians(deg)), -r * r


def _real(a, b):
    return a + b, -a * b


COEF = {0: _polar(0.905, 2.25), 1: _polar(0.88, 7.5), 2: _polar(0.95, 30.0), 3: _real(0.958, 0.15), 4: _real(0.845, 0.22), 5: _polar(0.67, 52.5)}


def decode(data, cid):
    """The bytes of a compressed sample -> float64 in sixteen-bit units."""
    if cid not in COEF:
        raise ValueError('compression ID %d: not measured' % cid)
    b = np.frombuffer(data, dtype=np.int8).astype(np.float64)
    c1, c2 = COEF[cid]
    return signal.lfilter([SCALE], [1.0, -c1, -c2], np.sign(b) * (2.0 ** (np.abs(b) / 16.0) - 1.0))


def chunks(b):
    i = 0
    while i + 8 <= len(b):
        n = struct.unpack('>I', b[i + 4:i + 8])[0]
        yield b[i:i + 4], b[i + 8:i + 8 + n]
        i += 8 + n


def read_ksf(path):
    """name, rate, frames, start2 (2nd start), loop, end, and x: the sample as float64 in sixteen-bit units.
    A KSF may only point to another one's data (SMF1): then x is None and 'ref' names that file."""
    out = dict(path=path, x=None)
    for tag, d in chunks(open(path, 'rb').read()):
        if tag == b'SMP1':
            out['name'] = d[:16].decode('latin1').rstrip('\0 ')
            out['defkey'] = d[16]
            out['start'] = int.from_bytes(d[17:20], 'big')
            out['start2'], out['loop'], out['end'] = struct.unpack('>III', d[20:32])
        elif tag == b'SMD1':
            rate, attr, tune, ch, bits, frames = struct.unpack('>IBbBBI', d[:12])
            raw = d[12:]
            out.update(rate=rate, attr=attr, comp=bool(attr & 16), cid=attr & 15, looptune=tune, ch=ch, bits=bits, frames=frames)
            if ch != 1:
                raise ValueError('%s: %d channels' % (path, ch))
            if attr & 16:
                if bits != 8:
                    raise ValueError('%s: compressed with %d bits' % (path, bits))
                out['x'] = decode(raw[:frames], attr & 15)
            elif bits == 16:
                out['x'] = np.frombuffer(raw[:frames * 2], dtype='>i2').astype(np.float64)
            elif bits == 8:
                out['x'] = np.frombuffer(raw[:frames], dtype=np.int8).astype(np.float64) * 256.0
            else:
                raise ValueError('%s: %d bits' % (path, bits))
        elif tag == b'SMF1':
            out['ref'] = d[:12].split(b'\0')[0].decode('latin1').strip()
    return out


def read_kmp(path):
    """Multisample name and zones in key order: orig (original key), top (top key), tune (cents), level (unused),
    ksf (file name; 'SKIPPEDSAMPL' and 'INTERNALnnnn' are Korg's markers for no file / a ROM sample)."""
    out = dict(path=path, zones=[], name=os.path.splitext(os.path.basename(path))[0])
    for tag, d in chunks(open(path, 'rb').read()):
        if tag == b'MSP1':
            out['name'] = d[:16].decode('latin1').rstrip('\0 ')
        elif tag == b'RLP1':
            for k in range(0, len(d) - 17, 18):
                z = d[k:k + 18]
                out['zones'].append(dict(orig=z[0] & 0x7F, fixed=bool(z[0] & 0x80), top=z[1], tune=struct.unpack('b', z[2:3])[0],
                                         level=struct.unpack('b', z[3:4])[0], ksf=z[6:18].split(b'\0')[0].decode('latin1').strip()))
    return out


def read_ksc(path):
    """The KMP files a KSC lists, in order: entry n is RAM/Flash multisample n of the PCG made for it."""
    return [x.strip() for x in open(path, encoding='latin1').read().splitlines() if x.strip().upper().endswith('.KMP')]


def tree(folder):
    """Every file under a folder by upper-case name; a file in a folder nearer the top wins (the disks' sample
    folders are split over several disk folders, and a multisample's file is repeated beside its second half)."""
    have = {}
    for root, _, fs in sorted(os.walk(folder), key=lambda t: (t[0].count(os.sep), t[0])):
        for x in fs:
            have.setdefault(x.upper(), os.path.join(root, x))
    return have


def to_dec(kmp_path, have, out_dir):
    """Decode one multisample into out_dir (WAVs in 32-bit float, full scale = sixteen-bit full scale; zones.json).
    Returns (zones written, list of problems)."""
    import soundfile as sf
    m = read_kmp(kmp_path); os.makedirs(out_dir, exist_ok=True)
    zones, bad, lo, wavs = [], [], 0, {}
    for z in m['zones']:
        hi = z['top']; rng = [lo, hi]; lo = hi + 1
        f = z['ksf'].upper()
        if f.startswith('SKIPPEDSAMPL') or f.startswith('INTERNAL'):
            bad.append('%s: keys %d-%d have no sample file (%s)' % (m['name'], rng[0], rng[1], z['ksf'])); continue
        if f not in have:
            bad.append('%s: %s is missing' % (m['name'], z['ksf'])); continue
        k = read_ksf(have[f])
        if k['x'] is None and k.get('ref', '').upper() in have:
            k = read_ksf(have[k['ref'].upper()])
        if k['x'] is None or 'rate' not in k:
            bad.append('%s: %s holds no sample data' % (m['name'], z['ksf'])); continue
        if f not in wavs:
            wavs[f] = '%d.wav' % len(wavs)
            sf.write(os.path.join(out_dir, wavs[f]), (k['x'] / 32768.0).astype(np.float32), k['rate'], subtype='FLOAT')
        n = len(k['x']); end = min(k['end'], n - 1); loop = k['loop']
        looped = 0 <= loop < end
        zones.append(dict(wav=wavs[f], sampleName=k.get('name') or z['ksf'], keyRange=rng, velRange=[1, 127], rootKey=z['orig'], tuneCents=z['tune'],
                          looped=looped, loop=[loop, end] if looped else None, start2=k['start2'] if 0 < k['start2'] < n else 0,
                          rate=k['rate'], frames=n, attenuation_cB=0, fixedPitch=z['fixed'],
                          korg=dict(file=z['ksf'], compressed=k['comp'], id=k['cid'] if k['comp'] else None, bits=k['bits'], level=z['level'])))
    if zones:
        zones[-1]['keyRange'][1] = 127  # Korg: the last zone runs to the top of the keyboard
    json.dump(dict(source=os.path.basename(kmp_path), bank=0, program=0, preset=m['name'], info={}, zones=zones), open(os.path.join(out_dir, 'zones.json'), 'w'), indent=1)
    return len(zones), bad


if __name__ == '__main__':
    import sys
    for p in sys.argv[1:]:
        if p.upper().endswith('.KMP'):
            m = read_kmp(p); print(p, repr(m['name']))
            for z in m['zones']: print('   ', z)
        elif p.upper().endswith('.KSC'):
            print(p, read_ksc(p))
        else:
            k = read_ksf(p); x = k.pop('x'); print(p, k, None if x is None else 'peak %.0f' % np.abs(x).max())
