#!/usr/bin/env python3
"""Estimate packed size of all 128 GM melodic programs (+ drum kit 128:0) of a SoundFont.

For each preset, one velocity layer (the zones containing vel 100), unique samples only, mono.
Kept length per sample follows pack.py's policy:
  looped sample : min(loopEnd, maxlen)  (loop re-found inside maxlen if the authored loop ends later)
  unlooped      : min(length to -60 dB tail, maxlen)
Size = seconds x bitrate. Prints per-program seconds and totals.

Usage: python3 estimate_bank.py FILE.sf2|sf3 [--maxlen 2.5] [--kbps 48]
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sf2parse import SoundFont  # noqa: E402


def tail_len(x, floor_db=-60):
    pk = np.max(np.abs(x)) + 1e-12
    hop = 256
    n = len(x) // hop
    if n == 0:
        return len(x)
    env = np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1))
    above = np.nonzero(20 * np.log10(env / pk + 1e-12) > floor_db)[0]
    return (above[-1] + 1) * hop if len(above) else len(x)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sf'); ap.add_argument('--maxlen', type=float, default=2.5); ap.add_argument('--kbps', type=float, default=48)
    ap.add_argument('--drum-maxlen', type=float, default=1.5)
    a = ap.parse_args()
    s = SoundFont(a.sf)
    cache = {}
    rows = []
    presets = [(0, p) for p in range(128)] + [(128, 0)]
    for bank, prog in presets:
        try:
            regs = s.preset_zones(bank, prog)
        except StopIteration:
            continue
        regs = [r for r in regs if r['velRange'][0] <= 100 <= r['velRange'][1]]
        seen, secs = set(), 0.0
        maxlen = a.drum_maxlen if bank == 128 else a.maxlen
        for r in regs:
            si = r['sampleIndex']
            if si in seen or (s.shdr[si]['type'] & 0x0F) == 2:   # skip right channel of stereo pairs
                continue
            seen.add(si)
            h = s.shdr[si]
            if si not in cache:
                if s.is_sf3 and h['type'] & 0x10:
                    x, _ = s.decode_sample(si)
                else:
                    x, _ = s.decode_sample(si)
                cache[si] = (len(x), tail_len(x))
            n, nt = cache[si]
            ls, le = s.sample_loop(si)
            if r['sampleModes'] in (1, 3) and 0 < le <= n:
                k = min(le, maxlen * h['rate'])
            else:
                k = min(nt, maxlen * h['rate'])
            secs += k / h['rate']
        name = next(p['name'] for p in s.presets() if p['bank'] == bank and p['program'] == prog)
        rows.append((bank, prog, name, len(seen), secs))
    tot = 0
    for b, p, n, k, secs in rows:
        print(f'{b:3d}:{p:3d} {n:24s} {k:3d} samples {secs:6.1f} s  {secs * a.kbps / 8:7.0f} KB')
        tot += secs
    mel = [r[4] for r in rows if r[0] == 0]
    print(f'melodic programs: {len(mel)}  mean {np.mean(mel):.1f} s  median {np.median(mel):.1f} s  '
          f'total {sum(mel):.0f} s  ->  {sum(mel) * a.kbps / 8 / 1024:.1f} MB at {a.kbps:g} kb/s; '
          f'60 programs ~ {np.mean(mel) * 60 * a.kbps / 8 / 1024:.1f} MB')
    d = [r[4] for r in rows if r[0] == 128]
    if d:
        print(f'drum kit: {d[0]:.1f} s -> {d[0] * a.kbps / 8 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
