#!/usr/bin/env python3
"""Build samples/flash/: the sample sets that Trinity PCG files play as "RAM/Flash" multisamples (PBS-TRI option
sets such as TFD-1S). The folder stays out of the repository (.gitignore) and out of the public build.

A Trinity PCG never holds audio: a program names RAM/Flash multisample n, and n is the n-th multisample of the
sample set that was loaded with it, in the order of the set's KSC file. This script reads such a set from Korg's own
files (KSC + KMP + KSF, compressed samples included: korg_ksf.py) and writes one lossless pack per multisample plus
samples/flash/packs.json, which also lists each set's multisamples in KSC order. The page pairs an imported PCG
with the set of the same name (TFD-1S.PCG -> set TFD-1S).

  python tools/samples/build_flash.py --set "TFD-1S=<folder of the set>" [--set "TFD-2S=<folder>" ...] [--only TFD-1S]

<folder>: where the set's .KSC file is, with its KMP and KSF files anywhere below (disk folders are fine).
Needs Python with numpy, scipy and soundfile, and ffmpeg. Use only sample sets you may use; nothing is uploaded.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import korg_ksf  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--set', action='append', default=[], metavar='NAME=FOLDER')
ap.add_argument('--only', action='append', default=[], help='rebuild only these sets (the others keep their packs)')
ap.add_argument('--out', default='samples/flash')
ap.add_argument('--licence', default='sample set of the owner; private copy, not for distribution')
A = ap.parse_args()
OUT = os.path.join(ROOT, A.out)
WORK = os.path.join(HERE, 'src', 'flash')  # decoded WAVs and pack.py's files (in .gitignore)
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
clean = lambda s: re.sub(r'[^a-z0-9_-]', '_', s.lower())


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr)[-3000:]


def build(job):
    name, kmp, have = job
    w = os.path.join(WORK, name); dec = os.path.join(w, 'dec')
    shutil.rmtree(w, ignore_errors=True)
    n, bad = korg_ksf.to_dec(kmp, have, dec)
    if not n:
        return name, None, bad or ['no zones']
    zs = json.load(open(os.path.join(dec, 'zones.json')))['zones']
    rate = max(z['rate'] for z in zs)  # a multisample's samples at their own rate (pack.py resamples the others up)
    c, log = run([sys.executable, os.path.join(HERE, 'pack.py'), '--sf-zones', os.path.join(dec, 'zones.json'), '--name', name, '--kind', 'auto', '--exact',
                  '--rate', str(rate), '--formats', 'flac', '--licence', A.licence, '--out', w])
    if c:
        return name, None, bad + ['pack failed: ' + log]
    return name, json.load(open(os.path.join(w, name + '.json'))), bad


index_path = os.path.join(OUT, 'packs.json')
index = json.load(open(index_path)) if os.path.exists(index_path) else dict(packs={}, sets={})
for spec in A.set:
    sname, _, folder = spec.partition('=')
    if A.only and sname not in A.only:
        continue
    have = korg_ksf.tree(folder)
    ksc = sorted(v for k, v in have.items() if k.endswith('.KSC'))
    if not ksc:
        sys.exit(sname + ': no .KSC file under ' + folder)
    order = korg_ksf.read_ksc(ksc[0])
    jobs, entries = [], []
    for n, f in enumerate(order):
        pack = 'f_' + clean(sname) + '_' + clean(os.path.splitext(f)[0])
        if f.upper() not in have:
            print(sname, n, f, 'is not in the folder'); entries.append(dict(p=None, name=f)); continue
        entries.append(dict(p=pack, name=korg_ksf.read_kmp(have[f.upper()])['name'], file=f))
        jobs.append((pack, have[f.upper()], have))
    for old in [k for k, v in index['packs'].items() if v.get('set') == sname]:
        index['packs'].pop(old)
    with ThreadPoolExecutor(max_workers=4) as ex:
        for name, m, bad in ex.map(build, jobs):
            for b in bad:
                print('  note:', b)
            if not m:
                print(name, 'FAILED'); [e.update(p=None) for e in entries if e['p'] == name]; continue
            f = m['files']['flac']['file']
            shutil.copyfile(os.path.join(WORK, name, f), os.path.join(OUT, name + '.flac'))
            # [start, length, loop start, loop end, gain dB, zones, 2nd start]: as samples/packs.json, plus the 2nd start
            smp = [[e['start'], e['length'], -1 if e['loopStart'] is None else e['loopStart'], -1 if e['loopEnd'] is None else e['loopEnd'], e['gainDb'],
                    [[z['keyRange'][0], z['keyRange'][1], z['rootKey'], z['tuneCents']] for z in e['zones']], e.get('start2', -1)] for e in m['samples']]
            index['packs'][name] = dict(file=os.path.basename(OUT.rstrip('/\\')) + '/' + name + '.flac', rate=m['rate'], sync=m['syncFrame'], search=m['syncSearch'], heal=0, set=sname, s=smp)
            print(name, 'ok:', len(smp), 'samples,', m['rate'], 'Hz', flush=True)
    index['sets'][sname] = entries
    print(sname + ':', sum(1 for e in entries if e['p']), 'of', len(entries), 'multisamples built')
index['licence'] = A.licence
index['source'] = 'Korg KSC/KMP/KSF sample sets read with tools/samples/korg_ksf.py'
json.dump(index, open(index_path, 'w'), separators=(',', ':'))
tot = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
print('sets', sorted(index['sets']), 'packs', len(index['packs']), 'total bytes', tot)
