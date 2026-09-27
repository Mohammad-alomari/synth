// Combination timbre checks: Delay start (timed, released early, key off) and the MIDI filters (damper, aftertouch, CC)
const H = require('./harness.js'); const X = H.load(H.ORDER); const sr = 48000;
const ok = (name, cond, extra) => { if (!cond) process.exitCode = 1; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + extra : '')); };
const timbre = o => Object.assign({ p: X.mossPreset(0), status: 'int', ch: 16, level: 127, transpose: 0, detune: 0, delay: 0, bend: null, pan: 'prog', send1: 'prog', send2: 'prog',
  keyBot: 0, keyTop: 127, keySlopeBot: 0, keySlopeTop: 0, velBot: 1, velTop: 127, velSlopeBot: 0, velSlopeTop: 0, rxDamper: 1, rxAT: 1, rxCC: 1 }, o);
function combi(t2) {
  const e = new X.MossEngine(sr), C = { kind: 'combi', name: 'test', timbres: [timbre({}), timbre(t2)], chains: [], blocks: [], fx: {}, voice: { hold: 0 }, out: { level: 127 } };
  e.handle({ t: 'patch', p: JSON.parse(JSON.stringify(C)) }); return e;
}
const run = (e, secs) => { const L = new Float32Array(128), R = new Float32Array(128); for (let b = 0; b < Math.round(secs * sr / 128); b++) e.process(L, R, 128); };
const act = (e, k) => e.combi.parts[k].voices.filter(v => v.active).length, gated = (e, k) => e.combi.parts[k].voices.filter(v => v.active && v.gate).length;
const pedalHeld = (e, k) => e.combi.parts[k].voices.filter(v => v.active && v.sustained).length;
{ const e = combi({ delay: 300 }); e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.1);
  const early = act(e, 1); run(e, 0.3);
  ok('delay 300 ms: timbre 2 silent at 0.1 s, playing at 0.4 s', act(e, 0) === 1 && early === 0 && act(e, 1) === 1, early + ' -> ' + act(e, 1)); }
{ const e = combi({ delay: 300 }); e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.1); e.handle({ t: 'off', n: 60 }); run(e, 0.5);
  ok('delay 300 ms, key released at 0.1 s: timbre 2 never starts', act(e, 1) === 0 && !e.combi.pending.length); }
{ const e = combi({ delay: -1 }); e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.2); const before = act(e, 1);
  e.handle({ t: 'off', n: 60 }); run(e, 0.05); const after = act(e, 1), g = gated(e, 1); run(e, 3);
  ok('key-off timbre: starts at release, then ends', before === 0 && after === 1 && g === 1 && act(e, 1) === 0, [before, after, g, act(e, 1)].join(' ')); }
{ const e = combi({ rxDamper: 0 }); e.handle({ t: 'cc', c: 64, v: 127 }); e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.1); e.handle({ t: 'off', n: 60 }); run(e, 0.05);
  ok('damper filter off: timbre 2 releases while timbre 1 is held by the pedal', pedalHeld(e, 0) === 1 && pedalHeld(e, 1) === 0 && gated(e, 1) === 0, pedalHeld(e, 0) + ' / ' + pedalHeld(e, 1)); }
{ const e = combi({ rxAT: 0, rxCC: 0 }); e.handle({ t: 'at', v: 0.8 }); e.handle({ t: 'cc', c: 1, v: 127 });
  const P = e.combi.parts;
  ok('aftertouch and CC filters off: timbre 2 does not receive them', P[0].ctl.at === 0.8 && P[1].ctl.at !== 0.8 && JSON.stringify(P[0].ctl) !== JSON.stringify(P[1].ctl)); }
{ const e = combi({ rxCC: 0 }); e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.05); e.handle({ t: 'cc', c: 123, v: 0 }); run(e, 0.05);
  ok('all-notes-off (CC 123) reaches every timbre', gated(e, 0) === 0 && gated(e, 1) === 0); }
