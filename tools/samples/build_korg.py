#!/usr/bin/env python3
"""Build samples/korg/ (Korg's own multisamples, used instead of the General MIDI stand-ins) from the owner's copy of
Korg's PBS-TRI sample libraries (KMP/KSF files). These recordings are Korg's: they stay out of the repository and out of
the public build (samples/korg/ is in .gitignore).

The multisamples to build are the ones PCM_KORG in pcmmap.js names. Each one goes
  KMP/KSF --ConvertWithMoss--> SoundFont 2 --extract_sf.py--> WAVs + zones.json --pack.py--> MP3 + map
and all maps are merged into samples/korg/packs.json (same format as samples/packs.json).

Run it in the tools container (ConvertWithMoss, Python, ffmpeg; nothing is installed on the host):
  docker build -t trinity-korg tools/samples/korg
  docker run --rm --network none -v "<repo>:/w" -v "<...>/SOUNDBANKS:/pbs:ro" -w /w trinity-korg python3 tools/samples/build_korg.py
Options: KORG_PBS=<folder> (default /pbs), names of packs to rebuild only those (e.g. k_bouzo069).
"""
import json, os, re, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PBS = os.environ.get('KORG_PBS', '/pbs')
OUT = os.path.join(ROOT, 'samples', 'korg')
WORK = os.path.join(HERE, 'src', 'korg')  # SoundFonts and decoded WAVs (in .gitignore)
LIC = 'Korg PBS-TRI sample libraries (Korg Inc.); private copy of the owner, not for distribution'
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)

# PCM_KORG: put(`n:FILE ...`, 'LIBRARY' ...)
src = open(os.path.join(ROOT, 'pcmmap.js'), encoding='utf-8').read()
files = set()
for body, lib in re.findall(r"put\(\s*[`']([^`']*)[`']\s*,\s*'([^']+)'", src):
    for x in body.split():
        files.add(lib + '/' + x.split(':')[1])
jobs = {}
for f in sorted(files):
    name = 'k_' + f.split('/')[-1].lower()
    if name in jobs: sys.exit('two files give the pack name ' + name)
    jobs[name] = f
only = set(sys.argv[1:])
if only: jobs = {k: v for k, v in jobs.items() if k in only}


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr)[-4000:]


def kmp_path(f):  # the libraries come from DOS disks: match names without regard to case
    d = PBS
    for part in (f + '.KMP').split('/'):
        hit = [e for e in os.listdir(d) if e.lower() == part.lower()] if os.path.isdir(d) else []
        if not hit: return None
        d = os.path.join(d, hit[0])
    return d


def stage(kmp, w):
    """ConvertWithMoss looks for a KMP's samples in the folder <KMP name>/, but on these disks the folders were renamed
    (EP_FM-4.KMP -> FM4_SAMP/, 11_SITAR.KMP -> 11SAMPLE/): link each sample the KMP names, found in the KMP's own folder
    tree, into that layout."""
    stem = os.path.splitext(os.path.basename(kmp))[0]; d = os.path.join(w, 'stage')
    os.makedirs(os.path.join(d, stem)); shutil.copyfile(kmp, os.path.join(d, stem + '.KMP'))
    have = {}
    for root, _, fs in sorted(os.walk(os.path.dirname(kmp)), key=lambda t: (t[0].count(os.sep), t[0])):
        for x in fs: have.setdefault(x.upper(), os.path.join(root, x))
    b = open(kmp, 'rb').read(); i = b.find(b'RLP1'); n = int.from_bytes(b[i + 4:i + 8], 'big') if i >= 0 else 0
    for k in range(i + 8, i + 8 + n - 17, 18):  # relative parameter table: 18 bytes per sample, file name in the last 12
        ref = b[k + 6:k + 18].split(b'\0')[0].decode('latin1').strip()
        if ref.upper() in have and not os.path.exists(os.path.join(d, stem, ref)): os.symlink(have[ref.upper()], os.path.join(d, stem, ref))
    return os.path.join(d, stem + '.KMP')


def build(name, f):
    kmp = kmp_path(f)
    if not kmp: return name, 'not found: ' + f
    w = os.path.join(WORK, name); sfd = os.path.join(w, 'sf2'); dec = os.path.join(w, 'dec')
    if not os.path.exists(os.path.join(dec, 'zones.json')):
        shutil.rmtree(w, ignore_errors=True); os.makedirs(sfd)
        c, log = run(['ConvertWithMoss', '-s', 'kmp', '-d', 'sf2', '-f', stage(kmp, w), sfd])
        shutil.rmtree(os.path.join(w, 'stage'), ignore_errors=True)
        sf2 = [x for x in os.listdir(sfd) if x.lower().endswith('.sf2')]
        if c or len(sf2) != 1: return name, 'ConvertWithMoss failed: ' + log
        c, log = run(['python3', os.path.join(HERE, 'extract_sf.py'), os.path.join(sfd, sf2[0]), '0', '0', dec, '--vel', 'all'])
        if c: return name, 'extract failed: ' + log
    # packed at the recordings' own rate (mostly 48 kHz): resampling would move the short loops of single cycles off their period
    rate = max(z['rate'] for z in json.load(open(os.path.join(dec, 'zones.json')))['zones'])
    c, log = run(['python3', os.path.join(HERE, 'pack.py'), '--sf-zones', os.path.join(dec, 'zones.json'), '--name', name, '--kind', 'auto',
                  '--rate', str(rate), '--maxlen', '8', '--floor', '-60', '--formats', 'mp3_48_fb', '--licence', LIC, '--out', w])
    if c: return name, 'pack failed: ' + log
    head = [x for x in log.splitlines() if x.startswith(name + ':')]
    return name, 'ok ' + (head[0] if head else '')


with ThreadPoolExecutor(max_workers=4) as ex:
    for name, res in ex.map(lambda kv: build(*kv), jobs.items()):
        print(name, res, flush=True)

# merge the maps of every pack built so far
packs = {}
for name in sorted(os.listdir(WORK)):
    mp = os.path.join(WORK, name, name + '.json')
    if not os.path.exists(mp): continue
    m = json.load(open(mp))
    mp3 = os.path.join(WORK, name, m['files']['mp3_48_fb']['file'])
    if not os.path.exists(mp3): continue
    shutil.copyfile(mp3, os.path.join(OUT, name + '.mp3'))
    smp = [[e['start'], e['length'], -1 if e['loopStart'] is None else e['loopStart'], -1 if e['loopEnd'] is None else e['loopEnd'], e['gainDb'],
            [[z['keyRange'][0], z['keyRange'][1], z['rootKey'], z['tuneCents']] for z in e['zones']]] for e in m['samples']]
    packs[name] = dict(file='korg/' + name + '.mp3', rate=m['rate'], sync=m['syncFrame'], search=m['syncSearch'], heal=m.get('healFrames', 64), s=smp)
json.dump(dict(licence=LIC, source='Korg PBS-TRI libraries (KMP/KSF), converted with ConvertWithMoss', packs=packs),
          open(os.path.join(OUT, 'packs.json'), 'w'), separators=(',', ':'))
tot = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
print('korg packs', len(packs), 'of', len(jobs) if not only else '?', 'total bytes', tot)
