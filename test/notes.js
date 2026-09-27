const H = require('./harness.js'); const X = H.load(H.ORDER); const C = {};
X.MOSS_PCG_BUILTIN.forEach(bk => { const rs = bk.rs || 521, by = Uint8Array.from(Buffer.from(bk.m, 'base64')), n = by.length / rs;
  for (let i = 0; i < n; i++) { const P = X.korgDecodeMoss(by.subarray(i * rs, (i + 1) * rs), bk.scale, bk.fmt); for (const t of P.korgInfo.notes) if (/effect|reverb/i.test(t)) C[t] = (C[t] || 0) + 1; } });
console.log(Object.entries(C).sort((a, b) => b[1] - a[1]));
