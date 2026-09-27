# Rebuilds the factory EXB-MOSS entry of pcgdata.js with 716-byte records (Trinity layout + Triton effect section)
# Usage: python3 gen_pcgdata.py <Factory_TritonExtreme.PCG>
import json, base64, struct, sys
if len(sys.argv) < 2: sys.exit('usage: python3 gen_pcgdata.py <Factory_TritonExtreme.PCG>')
src = open('pcgdata.js', encoding='utf-8').read()
arr = json.loads(src[src.index('['):src.rindex(']') + 1])
b = open(sys.argv[1], 'rb').read()
rd = lambda o: struct.unpack('>I', b[o:o + 4])[0]
p = b.find(b'PCG1', 4); end = min(len(b), p + 8 + rd(p + 4)); recs = []; o = p + 8
while o + 8 <= end:
    t = b[o:o + 4]; sz = rd(o + 4); d = o + 8
    if t in (b'PRG1', b'CMB1', b'DKT1'):
        q = d
        while q + 8 <= d + sz:
            t2 = b[q:q + 4]; s2 = rd(q + 4); n = rd(q + 8); rs = rd(q + 12)
            if t2 == b'MBK1' and rs >= 604:
                for i in range(n): recs.append(b[q + 20 + i * rs:q + 20 + i * rs + 604])
            q += 8 + s2
    o += 8 + sz
out = bytearray()
for r in recs:
    t = bytearray(521 + 195)
    t[0:16] = r[0:16]; t[16:409] = r[211:604]; t[409] = 120; t[521:716] = r[16:211]
    out += t
old = [x for x in arr if x.get('fmt') == 'triton'][0]
# the previous 521-byte records must match the Trinity part of the new ones
prev = base64.b64decode(old['m'])
assert len(prev) == 521 * len(recs)
for i in range(len(recs)): assert prev[i * 521:(i + 1) * 521] == bytes(out[i * 716:i * 716 + 521]), i
old['m'] = base64.b64encode(bytes(out)).decode(); old['rs'] = 716
open('pcgdata.js', 'w', encoding='utf-8').write('const MOSS_PCG_BUILTIN = ' + json.dumps(arr) + ';\n')
print(len(recs), 'records, OK')
