# Assembles the single-file synth: ui.html template + sources and fonts inlined as <script> / <style> blocks
# Usage: python3 build.py [out.html] [--public]
#   --public  leaves out the owner's own files (tridata.js and pcgdata.js); used for the
#             Netlify site. Visitors import their own PCG files instead.
import base64, json, re, sys
args = [a for a in sys.argv[1:] if not a.startswith('--')]
public = '--public' in sys.argv
out = args[0] if args else 'index.html'
# the user interface, in this order (later files use what earlier ones declare; boot.js starts the page)
APP_FILES = ['core.js', 'pages.js', 'program.js', 'scale.js', 'keyboard.js', 'record.js', 'midi.js', 'midimode.js', 'boot.js']

def source(f):
    code = open(f, encoding='utf-8').read()
    if public and f == 'tridata.js':
        return 'const TRI_BUILTIN = []; // public build: no built-in Trinity files\n'
    if public and f == 'pcgdata.js':
        return 'const MOSS_PCG_BUILTIN = []; // public build: no built-in Bank M files\n'
    return code

ui = open('ui.html', encoding='utf-8').read()
# the web fonts (fonts/, SIL Open Font License) are inlined, so the page needs no font server and works offline
fonts = json.load(open('fonts/fonts.json', encoding='utf-8'))
ui = ui.replace('%%FONTS%%', '\n'.join("@font-face { font-family: '%s'; font-style: normal; font-weight: %s; font-display: swap; src: url(data:font/woff2;base64,%s) format('woff2'); unicode-range: %s; }"
  % (f['family'], f['weight'], base64.b64encode(open('fonts/' + f['file'], 'rb').read()).decode(), f['range']) for f in fonts))
parts = {'PATCHES': ['fxcat.js', 'patches.js'], 'ENGINE': ['engine.js', 'pcm.js', 'combi.js', 'fxdsp.js'], 'KORG': ['pcmmap.js', 'korg.js'], 'PCG': ['pcgdata.js', 'tridata.js'],
  'APP': ['app/' + f for f in APP_FILES]}
for k, files in parts.items():
    code = '\n'.join(source(f) for f in files)
    code = re.sub(r"^if \(typeof module !== 'undefined'\)[^\n]*\n", '', code, flags=re.M)
    if k == 'APP': code = "(() => {\n'use strict';\n" + code + '})();\n'  # the app/ files share one scope, not the page's global one
    assert '</script' not in code.lower(), k
    tag = '%%' + k + '%%'
    assert ui.count(tag) == 1, k
    ui = ui.replace(tag, code.rstrip('\n'))
open(out, 'w', encoding='utf-8').write(ui)
print('built', out, len(ui), 'bytes' + (' (public: without the owner\'s files)' if public else ''))
