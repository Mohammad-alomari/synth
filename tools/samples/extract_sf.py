#!/usr/bin/env python3
"""Extract one preset's multisample from an SF2/SF3 into decoded WAVs + a zone manifest.

This keeps the SoundFont's *authored* data (root key, key ranges, tuning, loop points), which is the
closest thing to a ROM multisample: one sample per key zone, looped for sustained sounds.

Usage:
  python3 extract_sf.py SF_FILE BANK PROG OUT_DIR [--vel 100] [--mono mix|left]

  --vel   : keep only the zones whose velocity range contains this velocity (one layer, like a
            single Trinity multisample); use --vel all to keep every layer.
Writes OUT_DIR/<sampleIndex>.wav (float32 mono, native rate) and OUT_DIR/zones.json.
"""
import argparse
import json
import os
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sf2parse import SoundFont  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sf'); ap.add_argument('bank', type=int); ap.add_argument('prog', type=int); ap.add_argument('out')
    ap.add_argument('--vel', default='100')
    ap.add_argument('--mono', default='mix', choices=['mix', 'left'])
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    s = SoundFont(a.sf)
    regions = s.preset_zones(a.bank, a.prog)
    if a.vel != 'all':
        v = int(a.vel)
        regions = [r for r in regions if r['velRange'][0] <= v <= r['velRange'][1]]
    # group stereo pairs: SF2 sampleType 2 = right, 4 = left. The `link` field is unreliable (0 in
    # MuseScore's SF3), so pair by zone: same key+velocity range, one left and one right sample.
    def partner(r, want):
        for z in regions:
            if (z is not r and z['keyRange'] == r['keyRange'] and z['velRange'] == r['velRange']
                    and (s.shdr[z['sampleIndex']]['type'] & 0x0F) == want):
                return z
        return None

    zones, done = [], {}
    for r in regions:
        si = r['sampleIndex']
        h = s.shdr[si]
        stype = h['type'] & 0x0F
        if stype == 2 and partner(r, 4) is not None:
            continue  # right half of a pair: handled with its left partner
        if si not in done:
            x, rate = s.decode_sample(si)
            pr = partner(r, 2) if stype == 4 else None
            if pr is not None and a.mono == 'mix':
                xr, _ = s.decode_sample(pr['sampleIndex'])
                n = min(len(x), len(xr))
                x = 0.5 * (x[:n] + xr[:n])
            ls, le = s.sample_loop(si)
            sf.write(os.path.join(a.out, f'{si}.wav'), x, rate, subtype='FLOAT')
            done[si] = dict(frames=len(x), rate=rate, loop=[int(ls), int(le)])
        zones.append(dict(
            wav=f'{si}.wav', sampleName=r['sampleName'], keyRange=list(r['keyRange']), velRange=list(r['velRange']),
            rootKey=r['rootKey'], tuneCents=r['tuneCents'], looped=r['sampleModes'] in (1, 3),
            loop=done[si]['loop'], rate=done[si]['rate'], frames=done[si]['frames'],
            attenuation_cB=r['attenuation_cB'], pan=r['pan'], exclusiveClass=r['exclusiveClass'],
            gens=r['gens']))
    meta = dict(source=os.path.basename(a.sf), bank=a.bank, program=a.prog,
                preset=next(p['name'] for p in s.presets() if p['bank'] == a.bank and p['program'] == a.prog),
                info={k: v for k, v in s.info.items() if k in ('INAM', 'ICOP', 'IENG', 'ICMT')},
                zones=zones)
    with open(os.path.join(a.out, 'zones.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    secs = sum(d['frames'] / d['rate'] for d in done.values())
    print(f"{meta['preset']}: {len(zones)} zones, {len(done)} unique samples, {secs:.1f} s of audio")


if __name__ == '__main__':
    main()
