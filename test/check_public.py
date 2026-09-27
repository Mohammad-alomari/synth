# The public build (Netlify) must not contain the owner's own files: no built-in Trinity files and no built-in
# Bank M banks. Exit code 0 = ok.
import json, os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(tempfile.mkdtemp(), 'public.html')
subprocess.run([sys.executable, 'build.py', out, '--public'], cwd=ROOT, check=True, capture_output=True)
page = open(out, encoding='utf-8').read()
src = open(os.path.join(ROOT, 'tridata.js'), encoding='utf-8').read()
own = [t['name'] for t in json.loads(src[src.index('['):src.rindex(']') + 1])]
fails = [n for n in own if n in page]
if 'const TRI_BUILTIN = [];' not in page: fails.append('TRI_BUILTIN not empty')
if 'const MOSS_PCG_BUILTIN = [];' not in page: fails.append('built-in Bank M banks present')
print('public build: ok (%d KB)' % (len(page) // 1024) if not fails else 'public build contains the owner\'s data: %s' % fails)
sys.exit(1 if fails else 0)
