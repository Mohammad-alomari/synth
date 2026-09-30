# Assembles the single-file synth: ui.html template + sources and fonts inlined as <script> / <style> blocks
# Usage: python3 build.py [out.html] [--public] [--data DIR]
#   Built-in banks (pcgdata.js, tridata.js, userdata.js) are optional: your own go in private/ (ignored by git); a file
#   that is not there means no built-in banks of that kind.
#   --data DIR  takes them from DIR instead (the browser test builds with the made-up test banks, test/fixtures)
#   --public    no built-in banks at all; used for the Netlify site. Visitors import their own PCG files instead.
import base64, json, os, re, sys
argv = sys.argv[1:]
data = 'private'
if '--data' in argv: i = argv.index('--data'); data = argv[i + 1]; del argv[i:i + 2]
args = [a for a in argv if not a.startswith('--')]
public = '--public' in argv
out = args[0] if args else 'index.html'
DATA = {'pcgdata.js': 'const MOSS_PCG_BUILTIN = [];', 'tridata.js': 'const TRI_BUILTIN = [];', 'userdata.js': 'const USER_TRITON = null;'}
# the user interface, in this order (later files use what earlier ones declare; boot.js starts the page)
APP_FILES = ['core.js', 'pages.js', 'program.js', 'scale.js', 'keyboard.js', 'record.js', 'midi.js', 'midimode.js', 'boot.js']

def source(f):
    if f in DATA:
        p = os.path.join(data, f)
        if public or not os.path.exists(p): return DATA[f] + ' // no built-in banks of this kind\n'
        return open(p, encoding='utf-8').read()
    code = open(f, encoding='utf-8').read()
    if f == 'pcmmap.js' and not public:  # Korg recordings and your own sample disks (build_korg.py), when built here
        if os.path.exists('samples/korg/packs.json'): code = code.replace('const PCM_KORG_BUILT = false;', 'const PCM_KORG_BUILT = true;')
        # samples/user/ holds the multisamples of your own userdata.js (private/), not those of other data
        if data == 'private' and os.path.exists('samples/user/packs.json'): code = code.replace('const PCM_USER_BUILT = false;', 'const PCM_USER_BUILT = true;')
    return code

ui = open('ui.html', encoding='utf-8').read()
# the web fonts (fonts/, SIL Open Font License) are inlined, so the page needs no font server and works offline
fonts = json.load(open('fonts/fonts.json', encoding='utf-8'))
ui = ui.replace('%%FONTS%%', '\n'.join("@font-face { font-family: '%s'; font-style: normal; font-weight: %s; font-display: swap; src: url(data:font/woff2;base64,%s) format('woff2'); unicode-range: %s; }"
  % (f['family'], f['weight'], base64.b64encode(open('fonts/' + f['file'], 'rb').read()).decode(), f['range']) for f in fonts))
parts = {'PATCHES': ['fxcat.js', 'patches.js'], 'ENGINE': ['engine.js', 'pcm.js', 'combi.js', 'fxdsp.js'], 'KORG': ['pcmmap.js', 'korg.js'], 'PCG': ['pcgdata.js', 'tridata.js', 'userdata.js'],
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
own = [f for f in DATA if not public and os.path.exists(os.path.join(data, f))]
print('built', out, len(ui), 'bytes', '(public: no built-in banks)' if public else '(built-in banks from %s: %s)' % (data, ', '.join(own)) if own else '(no built-in banks)')
