#!/usr/bin/env python3
"""Build a private folder of sample packs from Korg KMP/KSF multisamples; they stay out of the repository and out of the
public build (samples/korg/ and samples/user/ are in .gitignore).

  default: samples/korg/ from the owner's copy of Korg's PBS-TRI libraries: the multisamples PCM_KORG in pcmmap.js names
  --all:   every KMP under --lib, e.g. the owner's own sample disks (Triton/Trinity RAM samples) for samples/user/

Each multisample goes
  KMP/KSF --ConvertWithMoss--> SoundFont 2 --extract_sf.py--> WAVs + zones.json --pack.py--> MP3 + map
and all maps are merged into <out>/packs.json (same format as samples/packs.json).

Run it in the tools container (ConvertWithMoss, Python, ffmpeg; nothing is installed on the host):
  docker build -t trinity-korg tools/samples/korg
  docker run --rm --network none -v "<repo>:/w" -v "<...>/SOUNDBANKS:/pbs:ro" -w /w trinity-korg python3 tools/samples/build_korg.py
  docker run --rm --network none -v "<repo>:/w" -v "<sample disk folder>:/user:ro" -w /w trinity-korg python3 tools/samples/build_korg.py \
      --all --lib /user --prefix u_ --out samples/user --licence "the owner's own samples"
Options: --lib <folder> (default $KORG_PBS or /pbs), names of packs to rebuild only those (e.g. k_bouzo069).
"""
import argparse, json, os, re, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ap = argparse.ArgumentParser()
ap.add_argument('only', nargs='*'); ap.add_argument('--all', action='store_true'); ap.add_argument('--lib', default=os.environ.get('KORG_PBS', '/pbs'))
ap.add_argument('--prefix', default='k_'); ap.add_argument('--out', default='samples/korg')
ap.add_argument('--licence', default='Korg PBS-TRI sample libraries (Korg Inc.); private copy of the owner, not for distribution')
A = ap.parse_args()
PBS, LIC = A.lib, A.licence
OUT = os.path.join(ROOT, A.out)
WORK = os.path.join(HERE, 'src', os.path.basename(A.out.rstrip('/')))  # SoundFonts and decoded WAVs (in .gitignore)
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
pack_name = lambda f: A.prefix + re.sub(r'[^a-z0-9_-]', '_', f.split('/')[-1].lower())  # the app uses the same rule

files = set()
if A.all:  # every KMP in the library, by its path under --lib
    for root, _, fs in os.walk(PBS):
        for x in fs:
            if x.upper().endswith('.KMP'): files.add(os.path.relpath(os.path.join(root, x[:-4]), PBS).replace(os.sep, '/'))
else:  # PCM_KORG: put(`n:FILE ...`, 'LIBRARY' ...)
    src = open(os.path.join(ROOT, 'pcmmap.js'), encoding='utf-8').read()
    for body, lib in re.findall(r"put\(\s*[`']([^`']*)[`']\s*,\s*'([^']+)'", src):
        for x in body.split():
            files.add(lib + '/' + x.split(':')[1])
jobs = {}
for f in sorted(files):
    name = pack_name(f)
    if name in jobs: sys.exit('two files give the pack name ' + name)
    jobs[name] = f
if A.only: jobs = {k: v for k, v in jobs.items() if k in A.only}


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
    zs = json.load(open(os.path.join(dec, 'zones.json')))['zones']
    if not zs: return name, 'no key zones in the converted multisample'
    rate = max(z['rate'] for z in zs)
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
    packs[name] = dict(file=os.path.basename(OUT.rstrip('/')) + '/' + name + '.mp3', rate=m['rate'], sync=m['syncFrame'], search=m['syncSearch'], heal=m.get('healFrames', 64), s=smp)
json.dump(dict(licence=LIC, source='Korg KMP/KSF multisamples, converted with ConvertWithMoss', packs=packs),
          open(os.path.join(OUT, 'packs.json'), 'w'), separators=(',', ':'))
tot = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
print('packs', len(packs), 'of', len(jobs) if not A.only else '?', 'total bytes', tot)
