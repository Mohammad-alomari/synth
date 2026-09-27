const H = require('./harness.js'); const X = H.load(H.ORDER); const C = {}, ex = {};
X.MOSS_PCG_BUILTIN.forEach(bk => { const rs = bk.rs || 521, by = Uint8Array.from(Buffer.from(bk.m, 'base64')), n = by.length / rs;
  for (let i = 0; i < n; i++) { const r = by.subarray(i * rs, i * rs + 521), t1 = r[154], t2 = r[206], dbl = t1 >= 9;
    const nm = Buffer.from(r.subarray(0, 16)).toString('latin1').trim(), b = bk.fmt === 'triton' ? 'F' : 'M';
    for (const [o, t, sb] of [[1, t1, 168], [2, dbl ? -1 : t2, 220]]) if (t >= 7 && t <= 9) { const k = ['organ', 'epiano', 'brass'][t - 7] + (o === 2 ? '(osc2)' : ''); C[k] = (C[k] || 0) + 1; (ex[k] = ex[k] || []).push([b + i, nm, Array.from(r.subarray(sb, sb + 38)).map(x => x > 127 ? x - 256 : x).join(' ')]); }
  } });
console.log(C);
for (const k in ex) { console.log('==', k); ex[k].slice(0, +(process.env.N || 8)).forEach(e => console.log('  ', e[0].padEnd(6), e[1].padEnd(17), e[2])); }
