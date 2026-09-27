# Assembles the single-file synth: ui.html template + sources inlined as <script> blocks
# Usage: python3 build.py [out.html] [--public]
#   --public  leaves out the owner's own files (tridata.js and the owner's Bank M banks in pcgdata.js); used for the
#             Netlify site. Visitors import their own PCG files instead.
import json, re, sys
args = [a for a in sys.argv[1:] if not a.startswith('--')]
public = '--public' in sys.argv
out = args[0] if args else 'index.html'

def source(f):
    code = open(f, encoding='utf-8').read()
    if public and f == 'tridata.js':
        return 'const TRI_BUILTIN = []; // public build: no built-in Trinity files\n'
    if public and f == 'pcgdata.js':  # keep only the Korg factory bank
        banks = [b for b in json.loads(code[code.index('['):code.rindex(']') + 1]) if b.get('fmt') == 'triton']
        return 'const MOSS_PCG_BUILTIN = ' + json.dumps(banks) + ';\n'
    return code

ui = open('ui.html', encoding='utf-8').read()
parts = {'PATCHES': ['fxcat.js', 'patches.js'], 'ENGINE': ['engine.js', 'pcm.js', 'combi.js', 'fxdsp.js'], 'KORG': ['pcmmap.js', 'korg.js'], 'PCG': ['pcgdata.js', 'tridata.js'], 'APP': ['app.js']}
for k, files in parts.items():
    code = '\n'.join(source(f) for f in files)
    code = re.sub(r"^if \(typeof module !== 'undefined'\)[^\n]*\n", '', code, flags=re.M)
    assert '</script' not in code.lower(), k
    tag = '%%' + k + '%%'
    assert ui.count(tag) == 1, k
    ui = ui.replace(tag, code.rstrip('\n'))
open(out, 'w', encoding='utf-8').write(ui)
print('built', out, len(ui), 'bytes' + (' (public: without the owner\'s files)' if public else ''))
