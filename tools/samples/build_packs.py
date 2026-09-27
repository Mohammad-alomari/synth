#!/usr/bin/env python3
"""Build the Trinity stand-in packs: one MP3 stream + map per General MIDI program / drum kit used by pcmmap.js.
Source: MuseScore's MS_General (file FluidR3Mono_GM.sf3), MIT licence. Output: samples/ at the repository root:
  <pack>.mp3 (mono, 32 kHz, 48 kb/s) and packs.json (all maps merged)."""
import json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # the repository root
SF = os.environ.get('SF3', os.path.join(HERE, 'src', 'FluidR3Mono_GM.sf3'))  # download it from MuseScore (MIT) first
OUT = os.path.join(ROOT, 'samples')
DEC = os.path.join(HERE, 'decoded_tri')
LIC = 'MIT: FluidR3 (Frank Wen), FluidR3Mono (Michael Cowgill), MS_General (S. Christian Collins)'
os.makedirs(OUT, exist_ok=True); os.makedirs(DEC, exist_ok=True)

src = open(os.path.join(ROOT, 'pcmmap.js'), encoding='utf-8').read()
gms = sorted(set(int(m) for m in re.findall(r"\bG\((\d+)", src)))
kits = {'kit_std': 0, 'kit_elec': 24, 'kit_808': 25, 'kit_brush': 40, 'kit_orch': 48}

def kind_for(n):
    if n <= 15 or 24 <= n <= 39 or n in (45, 46, 47) or 104 <= n <= 108 or 112 <= n <= 118: return 'decay', 2.0
    if n in (55, 119, 120, 123, 124, 127): return 'oneshot', 2.0
    return 'sustain', 2.2

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr)[-600:]

def build(name, bank, prog, kind, maxlen):
    d = os.path.join(DEC, name)
    if not os.path.exists(os.path.join(d, 'zones.json')):
        c, log = run(['python3', os.path.join(HERE, 'extract_sf.py'), SF, str(bank), str(prog), d])
        if c: return name, 'extract failed: ' + log
    tries = [kind] + (['oneshot'] if kind != 'oneshot' else [])
    for k in tries:
        c, log = run(['python3', os.path.join(HERE, 'pack.py'), '--sf-zones', os.path.join(d, 'zones.json'), '--name', name, '--kind', k,
                      '--rate', '32000', '--maxlen', str(maxlen if k != 'oneshot' else min(maxlen, 1.6)), '--floor', '-60',
                      '--formats', 'mp3_48_fb', '--licence', LIC, '--out', OUT])
        if c == 0: return name, 'ok ' + k
    return name, 'pack failed: ' + log

jobs = [('gm%03d' % n, 0, n) + kind_for(n) for n in gms] + [(k, 128, p, 'oneshot', 1.4) for k, p in kits.items()]
only = set(sys.argv[1:])
if only: jobs = [j for j in jobs if j[0] in only]
with ThreadPoolExecutor(max_workers=6) as ex:
    for name, res in ex.map(lambda j: build(*j), jobs):
        print(name, res, flush=True)

# merge maps
packs = {}
mapdir = os.path.join(DEC, '_maps'); os.makedirs(mapdir, exist_ok=True)
for f in os.listdir(OUT):  # maps of this run join the ones kept from earlier runs
    if f.endswith('.json') and f != 'packs.json': os.replace(os.path.join(OUT, f), os.path.join(mapdir, f))
for f in sorted(os.listdir(mapdir)):
    if not f.endswith('.json'): continue
    m = json.load(open(os.path.join(mapdir, f)))
    mp3 = m['files']['mp3_48_fb']['file']
    final = m['name'] + '.mp3'
    if os.path.exists(os.path.join(OUT, mp3)): os.replace(os.path.join(OUT, mp3), os.path.join(OUT, final))
    if not os.path.exists(os.path.join(OUT, final)): continue
    smp = []
    for e in m['samples']:
        smp.append([e['start'], e['length'], -1 if e['loopStart'] is None else e['loopStart'], -1 if e['loopEnd'] is None else e['loopEnd'], e['gainDb'],
                    [[z['keyRange'][0], z['keyRange'][1], z['rootKey'], z['tuneCents']] for z in e['zones']]])
    packs[m['name']] = dict(file=final, rate=m['rate'], sync=m['syncFrame'], search=m['syncSearch'], heal=m.get('healFrames', 64), s=smp)
json.dump(dict(licence=LIC, source='MS_General SoundFont (MuseScore), https://github.com/musescore/MuseScore/tree/main/share/sound', packs=packs),
          open(os.path.join(OUT, 'packs.json'), 'w'), separators=(',', ':'))
os.makedirs(os.path.join(DEC, '_maps'), exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.ref.wav'): os.replace(os.path.join(OUT, f), os.path.join(DEC, '_maps', f))
tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print('packs', len(packs), 'total bytes', tot)
