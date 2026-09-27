// Checks for note-handling fixes: sustain pedal, poly->mono switch, Hold, voice end, stealing order, portamento source
const H = require('./harness.js'); const X = H.load(H.ORDER); const sr = 48000;
const mk = (f) => { const P = X.mossPreset(0); P.fx.ins = []; P.fx.m1.on = 0; P.fx.m2.on = 0; if (f) f(P); const e = new X.MossEngine(sr); e.handle({ t: 'patch', p: P }); return e; };
const run = (e, secs) => { const L = new Float32Array(128), R = new Float32Array(128); let pk = 0; for (let b = 0; b < Math.round(secs * sr / 128); b++) { e.process(L, R, 128); for (let i = 0; i < 128; i++) pk = Math.max(pk, Math.abs(L[i])); } return pk; };
const act = e => e.voices.filter(v => v.active).length;
const ok = (name, cond, extra) => { if (!cond) process.exitCode = 1; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
{ // 1 sustain pedal with a repeated note
  const e = mk(); e.handle({ t: 'cc', c: 64, v: 127 }); e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.1); e.handle({ t: 'off', n: 60 }); e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.1);
  e.handle({ t: 'cc', c: 64, v: 0 }); run(e, 0.1); e.handle({ t: 'off', n: 60 }); run(e, 3); ok('sustain pedal + repeated note ends', act(e) === 0, 'active ' + act(e));
}
{ // 2 poly chord held, switch to a mono program, release keys
  const e = mk(); [60, 64, 67].forEach(n => e.handle({ t: 'on', n, v: 100 })); run(e, 0.1);
  const P2 = X.mossPreset(1); P2.fx.ins = []; e.handle({ t: 'patch', p: P2 }); [60, 64, 67].forEach(n => e.handle({ t: 'off', n })); run(e, 3);
  ok('poly -> mono program switch releases held chord', act(e) === 0, 'active ' + act(e));
}
{ // 3 Hold latch, re-press, then Hold off
  const e = mk(P => { P.voice.hold = 1; }); e.handle({ t: 'on', n: 60, v: 100 }); e.handle({ t: 'off', n: 60 }); e.handle({ t: 'on', n: 60, v: 100 }); e.handle({ t: 'off', n: 60 }); e.handle({ t: 'on', n: 64, v: 100 }); e.handle({ t: 'off', n: 64 }); run(e, 0.5);
  const gated = e.voices.filter(v => v.active && v.gate).length;
  ok('Hold: re-pressed latched note keeps one gated voice per key', gated === 2, 'gated ' + gated);
  e.handle({ t: 'set', path: 'voice.hold', v: 0 }); run(e, 3); ok('Hold off releases latched notes', act(e) === 0, 'active ' + act(e));
}
{ // 4 amps on EG1 with a release level above 0
  const e = mk(P => { P.amp[0].eg = 'eg1'; P.amp[1].eg = 'eg1'; Object.assign(P.eg[0], { startL: 0, atkT: 0, atkL: 99, decT: 10, brkL: 80, slpT: 10, susL: 70, relT: 30, relL: 25 }); });
  e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.3); e.handle({ t: 'off', n: 60 }); run(e, 1.5);
  ok('voice on EG1 with release level 25 ends', act(e) === 0, 'active ' + act(e));
  const e2 = mk(P => { P.osc[0].p.level = 0; P.osc[0].p.sine = 99; P.f[0].freqA = 99; P.amp[0].eg = 'eg1'; P.amp[1].eg = 'eg1'; Object.assign(P.eg[0], { startL: 0, atkT: 0, atkL: 99, decT: 10, brkL: 80, slpT: 10, susL: 70, relT: 30, relL: 25 }); });
  e2.handle({ t: 'on', n: 60, v: 100 }); run(e2, 0.3); e2.handle({ t: 'off', n: 60 });
  // measure the largest sample-to-sample step during the fade (a click would be a big jump)
  const L = new Float32Array(128), R = new Float32Array(128); let prev = null, jump = 0, pk = 0;
  for (let b = 0; b < 600; b++) { e2.process(L, R, 128); for (let i = 0; i < 128; i++) { if (prev !== null) jump = Math.max(jump, Math.abs(L[i] - prev)); prev = L[i]; pk = Math.max(pk, Math.abs(L[i])); } }
  ok('  ...and fades without a click (sine: natural step ~0.04 x peak)', jump < 0.06 * pk, 'max step ' + jump.toFixed(4) + ' peak ' + pk.toFixed(3));
}
{ // 5 stealing: pedal-held notes are stolen before a held key
  const e = mk(P => { P.voice.maxVoices = 6; }); e.handle({ t: 'cc', c: 64, v: 127 }); e.handle({ t: 'on', n: 36, v: 100 }); run(e, 0.05);
  for (const n of [60, 62, 64, 65, 67]) { e.handle({ t: 'on', n, v: 100 }); run(e, 0.02); e.handle({ t: 'off', n }); }
  e.handle({ t: 'on', n: 72, v: 100 }); run(e, 0.02);
  ok('held key survives stealing', e.voices.some(v => v.active && v.gate && v.note === 36));
}
{ // 6 portamento source during a legato glide
  const e = mk(P => { P.voice.mode = 'monoSingle'; P.voice.porta = 1; P.voice.portaTime = 60; });
  e.handle({ t: 'on', n: 48, v: 100 }); run(e, 0.2); e.handle({ t: 'on', n: 72, v: 100 }); run(e, 0.05);
  const v = e.voices.find(v => v.active); ok('portamento source moves during legato glide', v.src[20] > 0.05 && v.src[20] < 1, 'value ' + v.src[20].toFixed(3));
}
{ // 7 shared LFO follows MIDI sync
  const e = mk(P => { Object.assign(P.lfo[1], { sync: 'off', msync: 1, mbase: 4, mtimes: 0, freq: 0 }); P.voice.tempo = 120; });
  run(e, 0.3); e.handle({ t: 'on', n: 60, v: 100 }); const v = e.voices.find(v => v.active); run(e, 0.0);
  ok('shared LFO runs at the MIDI-sync rate', Math.abs(e.lfoRate[1] - 2) < 1e-9, 'rate ' + e.lfoRate[1]);
}
{ // 8 CC120 cuts, CC123 releases
  const e = mk(); e.handle({ t: 'on', n: 60, v: 100 }); run(e, 0.1); e.handle({ t: 'cc', c: 120, v: 0 }); ok('CC120 all sound off', act(e) === 0);
}
