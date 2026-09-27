#!/usr/bin/env python3
"""Print a compact table of a preset's regions: python3 zonesummary.py FILE BANK PROG"""
import sys
sys.path.insert(0, __import__('os').path.dirname(__file__))
from sf2parse import SoundFont
sf = SoundFont(sys.argv[1])
regs = sf.preset_zones(int(sys.argv[2]), int(sys.argv[3]))
uniq = {}
for r in regs:
    s = sf.shdr[r['sampleIndex']]
    ls, le = sf.sample_loop(r['sampleIndex'])
    n = s['end'] - s['start'] if not (sf.is_sf3 and s['type'] & 0x10) else None
    print(f"key {r['keyRange'][0]:3d}-{r['keyRange'][1]:3d} vel {r['velRange'][0]:3d}-{r['velRange'][1]:3d} root {r['rootKey']:3d} "
          f"tune {r['tuneCents']:4d} mode {r['sampleModes']} rate {r['rate']} loop {ls}-{le} type {s['type']} "
          f"bytes {s['end']-s['start']} {r['sampleName']}")
    uniq[r['sampleIndex']] = s['end'] - s['start']
print(len(regs), 'regions', len(uniq), 'unique samples', sum(uniq.values()), 'stored units (bytes for sf3, frames for sf2)')
