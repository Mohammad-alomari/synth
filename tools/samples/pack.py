#!/usr/bin/env python3
"""Pack one instrument's multisample into a single compact audio stream + JSON map.

Input (one of):
  --sf-zones decoded/<x>/zones.json   (from extract_sf.py: authored loop points, key ranges)
  --notes-dir decoded/<x>             (from fetch_notes.py: <midi>.wav per note, no loops)

Processing per sample:
  mono -> resample to --rate -> trim leading silence -> length policy by --kind:
    sustain : keep up to loop end. Use authored loop if present (moved earlier if the sample is longer
              than --maxlen), else search a loop by normalised cross-correlation inside the sustain
              region and apply a crossfade so the seam is continuous.
    decay   : (piano, plucked, mallets) keep --maxlen seconds, put a short loop at the tail with the
              envelope flattened across the loop, so a held note can sustain under the synth's amp EG.
    oneshot : (drums) cut where the tail falls below --floor dB re peak (max --maxlen), fade out, no loop.
    auto    : (Korg multisamples) a sample with an authored loop keeps it whatever its length; one without
              plays once, like oneshot.
  normalise each sample to -1 dBFS peak and store the gain in the map (so velocity/level stays authored).

Stream layout (mono, --rate):  [sync click][gap][s0 ... s0.loop tail pad][gap][s1 ...]...
  A Hann-windowed click at a known frame lets the browser find codec delay (MP3/AAC/Opus priming) after
  decodeAudioData: offset = argmax(|x[0:8192]|) - map.syncFrame.
  For looped samples, `pad` frames copied from the loop start are appended after loopEnd so that a lossy
  codec sees the same signal it will be spliced to (no pre-echo at the seam).

Outputs to --out: <name>.<ext> for each --formats entry, <name>.json (map), <name>.ref.wav (the exact PCM
that was encoded, used for quality measurement), and prints size/quality stats.

Formats: opus48 opus64 opus32 (Ogg) webmopus32 webmopus48 (WebM: decodes in Safari) mp3_48 mp3_64 aac48 vorbisq0 flac adpcm (IMA 4-bit, raw blob) mulaw
"""
import argparse
import glob
import json
import math
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, fftconvolve

SYNC_PRE = 256       # zeros before the click
SYNC_GAP = 4096      # zeros after the click (> any codec priming: AAC 2112, MP3 1105+529, Opus 312@48k)
SYNC_SEARCH = 3072   # browser searches argmax|x| in [0, syncFrame + SYNC_SEARCH)
SYNC_LEN = 32        # click length (Hann window)
GAP_SEC = 0.04       # silence between samples
PAD_SEC = 0.03       # loop-tail pad (copy of loop start after loop end)


# ----------------------------------------------------------------------------- DSP helpers
def to_rate(x, sr, rate):
    if sr == rate:
        return x.astype(np.float32)
    g = math.gcd(int(sr), int(rate))
    return resample_poly(x, rate // g, sr // g).astype(np.float32)


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def rms_env(x, hop):
    n = len(x) // hop
    if n == 0:
        return np.array([np.sqrt(np.mean(x ** 2)) + 1e-12])
    return np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-12


def find_loop(x, rate, f0, a, b, lmin, lmax, win=None):
    """Return (s, e, score): loop end e near b, loop start s in [e-lmax, e-lmin] with s >= a,
    maximising normalised cross-correlation of windows ending at s and e (so the audio just before
    the seam matches what follows the jump), refined to the best sample."""
    period = rate / f0
    win = win or int(max(4 * period, 0.02 * rate))
    e = int(b)
    best = None
    # try a handful of loop-end candidates near b (a period apart) and keep the best overall
    for k in range(6):
        ee = e - int(k * period)
        if ee - win < a:
            break
        tmpl = x[ee - win:ee]
        lo = max(a + win, ee - lmax)
        hi = ee - lmin
        if hi <= lo:
            continue
        seg = x[lo - win:hi]
        num = fftconvolve(seg, tmpl[::-1], mode='valid')          # sum over window ending at candidate
        c2 = np.concatenate([[0.0], np.cumsum(seg.astype(np.float64) ** 2)])
        en = c2[win:] - c2[:-win]
        score = num / (np.sqrt(en * np.dot(tmpl, tmpl)) + 1e-12)
        i = int(np.argmax(score))
        cand = (float(score[i]), lo + i, ee)
        if best is None or cand[0] > best[0]:
            best = cand
    if best is None:
        return None
    sc, s, e = best
    return s, e, sc


def crossfade_loop(x, s, e, n, equal_power):
    """Make x[e-n:e] blend into x[s-n:s] so that playback jumping e -> s is continuous."""
    n = int(min(n, s, e - s))
    if n < 8:
        return x
    t = (np.arange(n) + 0.5) / n
    if equal_power:
        g_out, g_in = np.cos(t * np.pi / 2), np.sin(t * np.pi / 2)
    else:
        g_out, g_in = 1 - t, t
    y = x.copy()
    y[e - n:e] = x[e - n:e] * g_out + x[s - n:s] * g_in
    return y


def flatten_env(x, s, e, rate):
    """Remove the decay slope inside [s, e) (dB-linear fit) so a tail loop does not pulse."""
    hop = max(64, int(0.01 * rate))
    env = rms_env(x[s:e], hop)
    t = (np.arange(len(env)) + 0.5) * hop
    p = np.polyfit(t, 20 * np.log10(env), 1)
    tt = np.arange(e - s)
    corr = 10 ** (-(p[0] * tt) / 20)      # undo the slope, level anchored at s
    y = x.copy()
    y[s:e] *= corr.astype(np.float32)
    return y


def trim_start(x, thresh_db=-60):
    pk = np.max(np.abs(x)) + 1e-12
    idx = np.nonzero(np.abs(x) > pk * 10 ** (thresh_db / 20))[0]
    if len(idx) == 0:
        return x, 0
    i0 = int(max(0, idx[0] - 16))
    return x[i0:], i0


def fade_out(x, n):
    n = min(n, len(x))
    x = x.copy()
    x[len(x) - n:] *= np.cos(np.linspace(0, np.pi / 2, n)) ** 2
    return x


# ----------------------------------------------------------------------------- codecs
def ima_adpcm_encode(x):
    """IMA ADPCM, 4 bits/sample, one continuous stream (initial predictor 0, index 0). Returns bytes."""
    steps = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88,
             97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
             724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660,
             4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
             18500, 20350, 22385, 24623, 27086, 29794, 32767]
    idx_tab = [-1, -1, -1, -1, 2, 4, 6, 8]
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype(np.int32).tolist()
    pred, idx = 0, 0
    out = bytearray((len(pcm) + 1) // 2)
    for i, s in enumerate(pcm):
        step = steps[idx]
        d = s - pred
        code = 0
        if d < 0:
            code = 8; d = -d
        diff = step >> 3
        if d >= step:
            code |= 4; d -= step; diff += step
        if d >= step >> 1:
            code |= 2; d -= step >> 1; diff += step >> 1
        if d >= step >> 2:
            code |= 1; diff += step >> 2
        pred = pred - diff if code & 8 else pred + diff
        pred = -32768 if pred < -32768 else 32767 if pred > 32767 else pred
        idx += idx_tab[code & 7]
        idx = 0 if idx < 0 else 88 if idx > 88 else idx
        if i & 1:
            out[i >> 1] |= code << 4
        else:
            out[i >> 1] = code
    return bytes(out)


def ima_adpcm_decode(b, n):
    steps = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88,
             97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
             724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660,
             4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
             18500, 20350, 22385, 24623, 27086, 29794, 32767]
    idx_tab = [-1, -1, -1, -1, 2, 4, 6, 8]
    pred, idx = 0, 0
    out = np.zeros(n, np.float32)
    for i in range(n):
        code = (b[i >> 1] >> 4) if i & 1 else (b[i >> 1] & 15)
        step = steps[idx]
        diff = step >> 3
        if code & 4: diff += step
        if code & 2: diff += step >> 1
        if code & 1: diff += step >> 2
        pred = pred - diff if code & 8 else pred + diff
        pred = -32768 if pred < -32768 else 32767 if pred > 32767 else pred
        idx += idx_tab[code & 7]
        idx = 0 if idx < 0 else 88 if idx > 88 else idx
        out[i] = pred / 32768.0
    return out


FFMPEG_ENC = {
    'opus32': ('opus', ['-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', '-application', 'audio']),
    'opus48': ('opus', ['-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-application', 'audio']),
    'opus64': ('opus', ['-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-application', 'audio']),
    'webmopus32': ('webm', ['-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', '-application', 'audio', '-f', 'webm']),
    'webmopus48': ('webm', ['-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-application', 'audio', '-f', 'webm']),
    # libopus only accepts 8/12/16/24/48 kHz input: without '-ar 48000' ffmpeg feeds it 24 kHz (12 kHz lowpass)
    # *_fb: force full audio bandwidth (default at 48 kb/s mono is a ~12 kHz lowpass; matters for cymbals/hats)
    'webmopus48_fb': ('webm', ['-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-application', 'audio',
                               '-cutoff', '20000', '-f', 'webm']),
    'webmopus64_fb': ('webm', ['-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-application', 'audio',
                               '-cutoff', '20000', '-f', 'webm']),
    'mp3_48_fb': ('mp3', ['-c:a', 'libmp3lame', '-b:a', '48k', '-cutoff', '15500']),
    'mp3_48': ('mp3', ['-c:a', 'libmp3lame', '-b:a', '48k']),
    'mp3_64': ('mp3', ['-c:a', 'libmp3lame', '-b:a', '64k']),
    'aac48': ('m4a', ['-c:a', 'aac', '-b:a', '48k']),
    'vorbisq0': ('ogg', ['-c:a', 'libvorbis', '-q:a', '0']),
    'flac': ('flac', ['-c:a', 'flac', '-sample_fmt', 's16', '-compression_level', '8']),
}


def encode(fmt, pcm, rate, base):
    if fmt in FFMPEG_ENC:
        ext, args = FFMPEG_ENC[fmt]
        path = f'{base}.{fmt}.{ext}'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0',
                        *args, '-map_metadata', '-1', path], input=pcm.astype('<f4').tobytes(), check=True)
        dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(rate), '-'],
                             capture_output=True, check=True).stdout
        return path, np.frombuffer(dec, '<f4')
    if fmt == 'adpcm':
        path = f'{base}.adpcm.bin'
        b = ima_adpcm_encode(pcm)
        open(path, 'wb').write(b)
        return path, ima_adpcm_decode(b, len(pcm))
    if fmt == 'mulaw':
        path = f'{base}.mulaw.bin'
        mu = 255.0
        y = np.sign(pcm) * np.log1p(mu * np.minimum(np.abs(pcm), 1)) / np.log1p(mu)
        q = np.round((y + 1) * 127.5).astype(np.uint8)
        open(path, 'wb').write(q.tobytes())
        yy = q.astype(np.float32) / 127.5 - 1
        return path, (np.sign(yy) * ((1 + mu) ** np.abs(yy) - 1) / mu).astype(np.float32)
    raise ValueError(fmt)


HEAL_N = 64  # frames; post-decode seam crossfade (do the same in the browser after decodeAudioData)


def heal_seam(d, s, e, n):
    """Post-decode loop-seam fix: blend the last n frames before loopEnd into the n frames before
    loopStart, removing codec noise mismatch at the jump. Returns a modified copy of d[:e]."""
    y = d[:e].copy()
    n = min(n, s, e - s)
    t = (np.arange(n) + 0.5) / n
    y[e - n:e] = d[e - n:e] * (1 - t) + d[s - n:s] * t
    return y


def align(dec, ref, sync_frame):
    # coarse: sync click peak (what the browser would do); fine: +-4 frames by correlation over 3 s
    k = int(np.argmax(np.abs(dec[:sync_frame + SYNC_SEARCH])))
    off0 = k - sync_frame
    n = min(len(ref), 3 * 48000)
    def score(o):
        seg = dec[max(0, o):max(0, o) + n]
        r = ref[max(0, -o):max(0, -o) + len(seg)]
        return float(np.dot(seg[:len(r)], r))
    off = max(range(off0 - 4, off0 + 5), key=score)
    if off >= 0:
        d = dec[off:off + len(ref)]
    else:
        d = np.concatenate([np.zeros(-off, np.float32), dec[:len(ref) + off]])
    if len(d) < len(ref):
        d = np.concatenate([d, np.zeros(len(ref) - len(d), np.float32)])
    return d, off


def lsd_db(ref, dec, n=1024):
    """Log-spectral distance (dB, frames above -50 dBFS only)."""
    m = (min(len(ref), len(dec)) // n) * n
    if m == 0:
        return float('nan')
    R = np.abs(np.fft.rfft(ref[:m].reshape(-1, n) * np.hanning(n), axis=1))
    D = np.abs(np.fft.rfft(dec[:m].reshape(-1, n) * np.hanning(n), axis=1))
    keep = 20 * np.log10(np.sqrt(np.mean(ref[:m].reshape(-1, n) ** 2, axis=1)) + 1e-9) > -50
    if not keep.any():
        return float('nan')
    R, D = R[keep], D[keep]
    floor = R.max(axis=1, keepdims=True) * 1e-3          # ignore bins > 60 dB below the frame peak
    R, D = np.maximum(R, floor), np.maximum(D, floor)
    d = 20 * np.log10(R) - 20 * np.log10(D)
    return float(np.mean(np.sqrt(np.mean(d ** 2, axis=1))))


# ----------------------------------------------------------------------------- inputs
def zones_from_sf(path):
    meta = json.load(open(path))
    d = os.path.dirname(path)
    zs = []
    for z in meta['zones']:
        x, sr = sf.read(os.path.join(d, z['wav']), dtype='float32', always_2d=True)
        zs.append(dict(x=x.mean(1), sr=sr, rootKey=z['rootKey'], keyRange=z['keyRange'], tuneCents=z['tuneCents'],
                       loop=z['loop'] if z['looped'] else None, name=z['sampleName'],
                       gainDb=-z['attenuation_cB'] / 10 * 0.4, id=z['wav']))  # 0.4: EMU/FluidSynth cB scaling
    # dedupe identical samples used by several key ranges (keep one entry per wav, union the ranges)
    return meta, zs


def zones_from_notes(d):
    src = json.load(open(os.path.join(d, 'source.json')))
    keys = sorted(int(os.path.basename(p)[:-4]) for p in glob.glob(os.path.join(d, '*.wav')))
    zs = []
    for i, k in enumerate(keys):
        lo = 0 if i == 0 else (keys[i - 1] + k) // 2 + 1
        hi = 127 if i == len(keys) - 1 else (k + keys[i + 1]) // 2
        x, sr = sf.read(os.path.join(d, f'{k}.wav'), dtype='float32', always_2d=True)
        zs.append(dict(x=x.mean(1), sr=sr, rootKey=k, keyRange=[lo, hi], tuneCents=0, loop=None,
                       name=str(k), gainDb=0.0, id=f'{k}.wav'))
    return src, zs


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--sf-zones'); g.add_argument('--notes-dir')
    ap.add_argument('--name', required=True)
    ap.add_argument('--kind', choices=['sustain', 'decay', 'oneshot', 'auto'], required=True)
    ap.add_argument('--rate', type=int, default=32000)
    ap.add_argument('--maxlen', type=float, default=2.5, help='seconds kept per sample (upper bound)')
    ap.add_argument('--minloop', type=float, default=0.25, help='min loop length (s) for found loops')
    ap.add_argument('--xfade', type=float, default=0.08, help='loop crossfade (s) for found loops')
    ap.add_argument('--floor', type=float, default=-60, help='oneshot tail cut, dB re peak')
    ap.add_argument('--licence', default='')
    ap.add_argument('--formats', default='opus48,mp3_48,aac48,vorbisq0,adpcm,flac')
    ap.add_argument('--out', default='packed')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rate = a.rate
    if a.sf_zones:
        srcmeta, zones = zones_from_sf(a.sf_zones)
        source = dict(kind='soundfont', file=srcmeta['source'], bank=srcmeta['bank'], program=srcmeta['program'],
                      preset=srcmeta['preset'], copyright=srcmeta['info'].get('ICOP', ''))
    else:
        srcmeta, zones = zones_from_notes(a.notes_dir)
        source = dict(kind='per-note recordings', pattern=srcmeta.get('url_pattern'), licence=srcmeta.get('licence'))

    # unique samples (SF zones can share a sample)
    uniq = {}
    for z in zones:
        uniq.setdefault(z['id'], dict(z, keyRanges=[]))['keyRanges'].append(
            dict(keyRange=z['keyRange'], rootKey=z['rootKey'], tuneCents=z['tuneCents']))

    stream = [np.zeros(SYNC_PRE, np.float32), np.hanning(SYNC_LEN + 2)[1:-1].astype(np.float32) * 0.95,
              np.zeros(SYNC_GAP, np.float32)]
    sync_frame = SYNC_PRE + int(np.argmax(np.hanning(SYNC_LEN + 2)[1:-1]))
    pos = sum(len(s) for s in stream)
    table, report = [], []
    for sid, z in uniq.items():
        x = to_rate(z['x'], z['sr'], rate)
        loop = None
        if z['loop'] is not None:
            loop = [int(round(v * rate / z['sr'])) for v in z['loop']]
        x, i0 = trim_start(x)
        if loop:
            loop = [loop[0] - i0, loop[1] - i0]
        f0 = midi_hz(z['keyRanges'][0]['rootKey'])
        maxn = int(a.maxlen * rate)
        info = ''
        kind = a.kind
        if kind == 'auto':
            kind = 'keep' if loop and 0 < loop[0] < loop[1] <= len(x) else 'oneshot'
        if kind in ('sustain', 'keep'):
            if loop and (kind == 'keep' or loop[1] <= maxn) and loop[0] > 0:
                # authored loop: keep; after resampling the points are rounded, so nudge the end by +-2
                # frames to the position whose preceding 16 frames best match those before loop start
                s0, e0 = loop
                best = min(range(-2, 3), key=lambda d: float(np.sum((x[e0 + d - 16:e0 + d] - x[s0 - 16:s0]) ** 2))
                           if e0 + d <= len(x) else 1e9) if s0 >= 16 else 0  # (a loop from the very start: kept as is)
                loop = [s0, e0 + best]
                x = x[:loop[1]]
                info = f'authored loop ({(loop[1] - loop[0]) / rate:.2f}s, end nudged {best:+d})'
            else:
                # no loop, or authored loop lies beyond maxlen: find one in [attack end, maxlen]
                hi = min(len(x), maxn)
                att = int(0.25 * rate) if hi > int(0.6 * rate) else int(0.1 * hi)
                r = find_loop(x, rate, f0, att, hi - int(0.01 * rate), int(a.minloop * rate),
                              int(max(a.minloop * rate * 2, hi - att - int(0.02 * rate))))
                if r is None:
                    raise SystemExit(f'no loop for {sid}')
                s, e, sc = r
                xf = min(int(a.xfade * rate), (e - s) // 2, s)
                x = crossfade_loop(x, s, e, xf, equal_power=sc < 0.9)[:e]
                loop = [s, e]
                info = f'found loop corr={sc:.3f} xfade={xf / rate * 1000:.0f}ms'
        elif kind == 'decay':
            hi = min(len(x), maxn)
            lmin = max(int(0.12 * rate), int(8 * rate / f0))
            r = find_loop(x, rate, f0, int(0.5 * hi), hi - int(0.005 * rate), lmin, int(0.4 * hi))
            s, e, sc = r
            x = flatten_env(x, s, e, rate)
            xf = min(int(0.04 * rate), (e - s) // 2, s)
            x = crossfade_loop(x, s, e, xf, equal_power=sc < 0.9)[:e]
            loop = [s, e]
            info = f'tail loop corr={sc:.3f}'
        else:  # oneshot
            pk = np.max(np.abs(x)) + 1e-12
            env = rms_env(x, int(0.005 * rate))
            above = np.nonzero(20 * np.log10(env / pk) > a.floor)[0]
            n = min(len(x), maxn, (above[-1] + 2) * int(0.005 * rate) if len(above) else len(x))
            x = fade_out(x[:n], int(min(0.05 * rate, n // 4)))
            loop = None
            info = f'oneshot {n / rate:.2f}s'
        peak = float(np.max(np.abs(x))) + 1e-12
        gain = 10 ** (-1 / 20) / peak
        x = (x * gain).astype(np.float32)
        body = [x]
        if loop:
            pad = int(PAD_SEC * rate)
            tail = x[loop[0]:loop[0] + pad]
            body.append(tail)
        body.append(np.zeros(int(GAP_SEC * rate), np.float32))
        entry = dict(id=sid, name=z['name'], start=pos, length=len(x),
                     loopStart=pos + loop[0] if loop else None, loopEnd=pos + loop[1] if loop else None,
                     zones=z['keyRanges'], gainDb=round(z['gainDb'] - 20 * math.log10(gain), 2))
        table.append(entry)
        report.append(f"  {z['name']:>22s} root {z['keyRanges'][0]['rootKey']:3d}  {len(x) / rate:5.2f}s  {info}")
        stream += body
        pos += sum(len(b) for b in body)
    pcm = np.concatenate(stream)
    base = os.path.join(a.out, a.name)
    sf.write(base + '.ref.wav', pcm, rate, subtype='FLOAT')
    audio_secs = sum(e['length'] for e in table) / rate
    print(f'{a.name}: {len(table)} samples, {audio_secs:.1f}s audio, stream {len(pcm) / rate:.1f}s @ {rate} Hz')
    print('\n'.join(report))
    files = {}
    for fmt in [f for f in a.formats.split(',') if f]:
        path, dec = encode(fmt, pcm, rate, base)
        d, off = align(dec, pcm, sync_frame)
        # quality over sample bodies only
        mask = np.zeros(len(pcm), bool)
        for e in table:
            mask[e['start']:e['start'] + e['length']] = True
        err = d[mask] - pcm[mask]
        snr = 10 * np.log10(np.sum(pcm[mask] ** 2) / (np.sum(err ** 2) + 1e-20))
        lsd = lsd_db(pcm[mask], d[mask])
        # loop seam: jump |x[e-1] -> x[s]| relative to typical step size near the seam, decoded vs reference
        seams, healed = [], []
        for e in table:
            if e['loopStart'] is not None:
                s_, e_ = e['loopStart'], e['loopEnd']
                typ = np.mean(np.abs(np.diff(d[e_ - 64:e_]))) + 1e-9
                seams.append(abs(d[s_] - d[e_ - 1]) / typ)
                h = heal_seam(d, s_, e_, HEAL_N)
                healed.append(abs(h[s_] - h[e_ - 1]) / typ)
        size = os.path.getsize(path)
        files[fmt] = dict(file=os.path.basename(path), bytes=size, codecOffset=int(off))
        seam_txt = (f'seam jump/step med {np.median(seams):.2f} max {max(seams):.2f} '
                    f'(healed max {max(healed):.2f})') if seams else ''
        print(f'  {fmt:9s} {size / 1024:8.1f} KiB  {size * 8 / (len(pcm) / rate) / 1000:6.1f} kb/s  '
              f'SNR {snr:5.1f} dB  LSD {lsd:4.2f} dB  offset {off:+5d}  {seam_txt}')
    m = dict(name=a.name, source=source, licence=a.licence, rate=rate, channels=1, syncFrame=sync_frame, syncSearch=SYNC_SEARCH,
             frames=len(pcm), files=files, samples=table,
             notes='positions are frames at `rate` from stream start; after decoding, shift by '
                   '(argmax|x[0:syncFrame+syncSearch]| - syncFrame). Decode with an OfflineAudioContext at `rate` '
                   'to keep loop points integer. Heal each loop seam after decoding: '
                   f'x[e-n+i] = x[e-n+i]*(1-t) + x[s-n+i]*t, n={HEAL_N}, t=(i+0.5)/n.', healFrames=HEAL_N)
    json.dump(m, open(base + '.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
