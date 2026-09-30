# The public build (Netlify) must not contain any built-in banks: neither your own (private/) nor the test banks.
# Exit code 0 = ok.
import json, os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(tempfile.mkdtemp(), 'public.html')
subprocess.run([sys.executable, 'build.py', out, '--public'], cwd=ROOT, check=True, capture_output=True)
subprocess.run(['node', os.path.join('test', 'fixtures.js')], cwd=ROOT, check=True, capture_output=True)
page = open(out, encoding='utf-8').read()
names = []
for d in ['private', os.path.join('test', 'fixtures')]:
    p = os.path.join(ROOT, d, 'tridata.js')
    if os.path.exists(p):
        src = open(p, encoding='utf-8').read()
        names += [t['name'] for t in json.loads(src[src.index('['):src.rindex(']') + 1])]
fails = [n for n in names if n in page]
for stub in ['const TRI_BUILTIN = [];', 'const MOSS_PCG_BUILTIN = [];', 'const USER_TRITON = null;']:
    if stub not in page: fails.append('missing: ' + stub)
print('public build: ok (%d KB, none of %d bank files)' % (len(page) // 1024, len(names)) if not fails else 'public build contains built-in banks: %s' % fails)
sys.exit(1 if fails else 0)
