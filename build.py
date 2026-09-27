# Assembles the single-file synth: ui.html template + sources inlined as <script> blocks
import re, sys
ui = open('ui.html', encoding='utf-8').read()
parts = {'PATCHES': ['fxcat.js', 'patches.js'], 'ENGINE': ['engine.js', 'pcm.js', 'combi.js', 'fxdsp.js'], 'KORG': ['pcmmap.js', 'korg.js'], 'PCG': ['pcgdata.js', 'tridata.js'], 'APP': ['app.js']}
for k, files in parts.items():
    code = '\n'.join(open(f, encoding='utf-8').read() for f in files)
    code = re.sub(r"^if \(typeof module !== 'undefined'\)[^\n]*\n", '', code, flags=re.M)
    assert '</script' not in code.lower(), k
    tag = '%%' + k + '%%'
    assert ui.count(tag) == 1, k
    ui = ui.replace(tag, code.rstrip('\n'))
open(sys.argv[1] if len(sys.argv) > 1 else 'index.html', 'w', encoding='utf-8').write(ui)
print('built', len(ui), 'bytes')
