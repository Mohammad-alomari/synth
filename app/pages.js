// Editor pages: parameter access, names and formats, MOSS / PCM / combination / effect pages and their rendering.
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
// ---------------- parameter access ----------------
function getP(path, obj) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj || patch); }
function setP(path, v, silent) {
  const ks = path.split('.'); let o = patch;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
  if (!silent) send({ t: 'set', path, v });
  if (!edited) { edited = true; lcd(); }
  saveCurrent();
  if (/^(mix|filt|osc\.\d\.type|f\.\d\.type|sub\.wave|osc\.\d\.p\.(mIn|rIn|cIn|vMod))/.test(path)) flowSoon();
}
let flowQ = 0;
function flowSoon() { if (!flowQ) flowQ = requestAnimationFrame(() => { flowQ = 0; renderFlow(); }); }
const DEF = mossDefaultPatch();
function defaultAt(path) { return getP(path, DEF); }

// ---------------- vocabulary ----------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const RATIOS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const DOUBLE = ['brass', 'reed', 'pluck', 'bowed'];
const F = {
  // the Trinity's own number first (as its screen shows it), then this model's reading of it in real units
  time: v => v + ' \u00b7 ' + (t => t === 0 ? '0 ms' : t < 1 ? Math.round(t * 1000) + ' ms' : t.toFixed(t < 10 ? 2 : 1) + ' s')(MD.tsec(v)),
  hz: v => v + ' \u00b7 ' + (h => h < 1000 ? Math.round(h) + ' Hz' : (h / 1000).toFixed(h < 10000 ? 2 : 1) + ' kHz')(MD.cutHz(v)),
  lfo: v => v + ' \u00b7 ' + (h => (h < 10 ? h.toFixed(2) : h.toFixed(1)) + ' Hz')(MD.lfoHz(v)),
  sgn: v => (v > 0 ? '+' : '') + v,
  oct: v => ({ '-2': "32'", '-1': "16'", '0': "8'", '1': "4'" })[v],
  note: n => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1),
  ratio: i => String(RATIOS[i]),
  pan: v => v === 64 ? 'C064' : (v < 64 ? 'L' : 'R') + String(Math.round(v)).padStart(3, '0'), // as the Trinity shows it: L000 \u2026 C064 \u2026 R127
  semis: v => (v > 0 ? '+' : '') + v + ' st',
  cents: v => (v > 0 ? '+' : '') + v + ' ct',
  slope: v => (v >= 0 ? '+' : '') + Number(v).toFixed(2),
  hzOff: v => (v > 0 ? '+' : '') + Number(v).toFixed(1) + ' Hz',
  ms: v => v + ' ms', pct: v => v + '%'
};
const OSC_TYPES = [['standard', 'Standard'], ['comb', 'Comb Filter'], ['vpm', 'VPM'], ['reso', 'Resonance'], ['ring', 'Ring Modulation'], ['cross', 'Cross Modulation'], ['sync', 'Sync Modulation'],
  ['organ', 'Organ Model'], ['epiano', 'E.Piano Model'], ['brass', 'Brass Model'], ['reed', 'Reed Model'], ['pluck', 'Plucked String Model'], ['bowed', 'Bowed String Model']];
const BRASS_TYPES = ['Brass 1', 'Brass 2', 'Brass 3', 'Horn 1', 'Horn 2', 'ReedBrass'].map((n, i) => [i, n]);
const ORGAN_WAVES = [[0, 'Sine 1 (pure)'], [1, 'Sine 2 (+2nd harmonic)'], [2, 'Sine 3 (+2nd, 3rd)'], [3, 'Triangle']];
// drawbar pitch in organ footage, with the oscillator at 8' (harmonic 1 is one octave below it)
const FOOT = { 1: "16'", 2: "8'", 3: "5\u2153'", 4: "4'", 5: "3\u2155'", 6: "2\u2154'", 8: "2'", 10: "1\u2157'", 12: "1\u2153'", 16: "1'" };
const fmtHarm = h => h + ' \u00b7 ' + (FOOT[h] || (16 / h).toFixed(2) + "'");
const REED_TYPES = ['Hard Sax 1', 'Hard Sax 2', 'Hard Sax 3', 'Soft Sax 1', 'Soft Sax 2', 'Double Reed 1', 'Double Reed 2', 'Bassoon', 'Clarinet', 'Flute 1', 'Flute 2', 'Pan Flute', 'Ocarina', 'Shakuhachi', 'Harmonica 1', 'Harmonica 2', 'Reed Synth'].map((n, i) => [i, n]);
const TYPE_SHORT = { standard: 'STANDARD', comb: 'COMB', vpm: 'VPM', reso: 'RESONANCE', ring: 'RING MOD', cross: 'CROSS MOD', sync: 'SYNC MOD', organ: 'ORGAN', epiano: 'E.PIANO', brass: 'BRASS', reed: 'REED', pluck: 'PLUCKED', bowed: 'BOWED' };
const CAR_OPTS = [['saw', 'Saw'], ['square', 'Square'], ['tri', 'Triangle'], ['sine', 'Sine']];
const LFO_OPTS = [['lfo1', 'LFO 1'], ['lfo2', 'LFO 2'], ['lfo3', 'LFO 3'], ['lfo4', 'LFO 4']];
const EG_OPTS = [['eg1', 'EG 1'], ['eg2', 'EG 2'], ['eg3', 'EG 3'], ['eg4', 'EG 4'], ['amp', 'Amp EG']];
const LFO_WAVES = [['tri0', 'Triangle 0'], ['tri90', 'Triangle 90'], ['trirnd', 'Triangle random'], ['sawup0', 'Saw up 0'], ['sawup180', 'Saw up 180'], ['sawdn0', 'Saw down 0'], ['sawdn180', 'Saw down 180'], ['square', 'Square'], ['sine', 'Sine'],
  ['stri4', 'Step triangle 4'], ['stri6', 'Step triangle 6'], ['ssaw4', 'Step saw 4'], ['ssaw6', 'Step saw 6'], ['rndsh', 'Random S/H'], ['rndvec', 'Random vector'], ['expsawup', 'Exp saw up'], ['expsawdn', 'Exp saw down'], ['exptri', 'Exp triangle']];
// what each oscillator type's modulation slots control (slot 0/1 are the classic Mod A/B)
const MOD_SLOTS = { standard: ['waveform', 'shaper input', 'shaper shape', 'shaper balance'], comb: ['feedback', 'high damp', 'input level'], vpm: ['modulator level', 'wave shape', 'carrier level', 'modulator pitch'],
  reso: ['harmonic shift', 'resonance', 'input level', 'band 1 harmonic', 'band 2 harmonic', 'band 3 harmonic', 'band 4 harmonic'], ring: ['depth', 'wave edge'], cross: ['depth', 'wave edge'], sync: ['slave pitch', 'wave edge'],
  bowed: ['bow speed', 'bow pressure', 'bowing point', 'damping', 'dispersion', 'reflection'], reed: ['breath pressure', 'reed', 'wave shape'], pluck: ['pluck position', 'dispersion', 'damping', 'harmonics', 'pickup position'],
  organ: ['drawbar 1 level', 'drawbar 2 level', 'drawbar 3 level', 'percussion level'], epiano: ['pickup position'], brass: ['pressure', 'lip character'] };
// Korg's alternate modulation source list (Trinity V3 MIDI implementation table [*3])
const SRC_OPTS = [['off', 'Off'], ['eg1', 'EG 1'], ['eg2', 'EG 2'], ['eg3', 'EG 3'], ['eg4', 'EG 4'], ['ampeg', 'Amp EG'], ['lfo1', 'LFO 1'], ['lfo2', 'LFO 2'], ['lfo3', 'LFO 3'], ['lfo4', 'LFO 4'],
  ['porta', 'Portamento'], ['velS', 'Velocity (soft)'], ['vel', 'Velocity (medium)'], ['velH', 'Velocity (hard)'], ['key', 'Note number (linear)'], ['keyExp', 'Note number (exp)'], ['splitH', 'Note split high'], ['splitL', 'Note split low'],
  ['at', 'Aftertouch'], ['jsx', 'JS X (bend)'], ['jsy', 'JS +Y (CC1)'], ['jsyn', 'JS \u2212Y (CC2)'], ['atjs', 'Aftertouch + JS +Y'], ['ribbon', 'Ribbon X (CC16)'], ['ribP', 'Ribbon +X'], ['ribN', 'Ribbon \u2212X'], ['ribZ', 'Ribbon touch'],
  ['foot', 'Foot pedal (CC4)'], ['slider', 'Value slider (CC18)'], ['kn1', 'Knob 1 (CC17)'], ['cc19', 'Knob 2 / MIDI CC19'], ['kn3', 'Knob 3 (CC20)'], ['kn4', 'Knob 4 (CC21)'], ['sw1', 'SW1 (CC80)'], ['sw2', 'SW2 (CC81)'], ['fsw', 'Foot switch (CC82)'], ['cc83', 'MIDI CC83']];
function dstOpts() {
  const slots = i => { const L = MOD_SLOTS[patch.osc[i].type] || ['mod A', 'mod B']; const n = i + 1;
    return L.map((lab, k) => ['o' + n + (k === 0 ? 'A' : k === 1 ? 'B' : 'm' + k), 'OSC ' + n + ': ' + lab]); };
  return [['off', 'Off'], ['pitch', 'Pitch, all oscillators'], ['pitch1', 'OSC 1 pitch'], ['pitch2', 'OSC 2 pitch'], ['pitchSub', 'Sub OSC pitch']].concat(slots(0), slots(1), [['o1Lvl', 'OSC 1 level'], ['o2Lvl', 'OSC 2 level'],
    ['fFreq', 'Filter 1+2 cutoff'], ['f1Freq', 'Filter 1 cutoff'], ['f1Reso', 'Filter 1 resonance'], ['f1FreqB', 'Filter 1 B cutoff'], ['f1ResoB', 'Filter 1 B resonance'],
    ['f2Freq', 'Filter 2 cutoff'], ['f2Reso', 'Filter 2 resonance'], ['f2FreqB', 'Filter 2 B cutoff'], ['f2ResoB', 'Filter 2 B resonance'], ['noiseFreq', 'Noise filter cutoff'],
    ['m1o1', 'Mixer 1 OSC 1'], ['m1o2', 'Mixer 1 OSC 2'], ['m1sub', 'Mixer 1 sub'], ['m1noise', 'Mixer 1 noise'], ['m1fb', 'Mixer 1 feedback'],
    ['m2o1', 'Mixer 2 OSC 1'], ['m2o2', 'Mixer 2 OSC 2'], ['m2sub', 'Mixer 2 sub'], ['m2noise', 'Mixer 2 noise'], ['m2fb', 'Mixer 2 feedback'],
    ['amp1', 'Amp 1 level'], ['amp2', 'Amp 2 level'], ['pan', 'Pan'], ['portaTime', 'Portamento time'], ['lfo1Rate', 'LFO 1 speed'], ['lfo2Rate', 'LFO 2 speed'], ['lfo3Rate', 'LFO 3 speed'], ['lfo4Rate', 'LFO 4 speed']]);
}

// ---------------- control descriptors ----------------
const S = (path, label, min, max, o) => Object.assign({ k: 's', path, label, min, max, step: 1 }, o || {});
const SEL = (path, label, opts, o) => Object.assign({ k: 'sel', path, label, opts }, o || {});
const BEND_STEPS = [[0, 'Continuous'], [0.125, '1/8 semitone'], [0.25, '1/4 semitone'], [0.5, '1/2 semitone']].concat([...Array(12)].map((_, i) => [i + 1, (i + 1) + ' semitone' + (i ? 's' : '')]));
const TOG = (path, label, o) => Object.assign({ k: 'tog', path, label }, o || {});
const ROUTING_HELP = {
  parallel: 'Mixer 1 feeds Filter 1 and Amp 1; Mixer 2 feeds Filter 2 and Amp 2.',
  serial1: 'Mixer 1 runs through Filter 1 then Filter 2 into Amp 1. Mixer 2 goes straight to Amp 2, unfiltered.',
  serial2: 'Mixer 1 runs through Filter 1 into Amp 1, and Filter 1\u2019s output also feeds Filter 2 into Amp 2. Mixer 2 is not used. This reading of Serial 2 comes from reviews, since Korg\u2019s own diagram is only in the scanned Z1 manual.'
};
const EG_MODS = s => [SEL(s + '.lvlSrc', 'Level mod source', SRC_OPTS), S(s + '.lvlInt', 'Level mod intensity', -99, 99, { fmt: F.sgn }),
  SEL(s + '.tSrc', 'Time mod source', SRC_OPTS), S(s + '.tInt', 'Time mod intensity', -99, 99, { fmt: F.sgn }),
  SEL(s + '.nSrc', 'Stage time source', SRC_OPTS), S(s + '.nAt', 'Attack time mod', -99, 99, { fmt: F.sgn }), S(s + '.nDc', 'Decay time mod', -99, 99, { fmt: F.sgn }),
  S(s + '.nSl', 'Slope time mod', -99, 99, { fmt: F.sgn }), S(s + '.nRl', 'Release time mod', -99, 99, { fmt: F.sgn })];
const DEF_EG = s => [S(s + '.atkT', 'Attack time', 0, 99, { fmt: F.time }), S(s + '.decT', 'Decay time', 0, 99, { fmt: F.time }), S(s + '.slpT', 'Slope time', 0, 99, { fmt: F.time }), S(s + '.relT', 'Release time', 0, 99, { fmt: F.time })];

function pageProgram() {
  return [
    { title: 'Program', controls: [
      { k: 'txt', path: 'name', label: 'Name' },
      SEL('voice.mode', 'Voice assign', [['poly', 'Poly'], ['monoSingle', 'Mono, single trigger'], ['monoMulti', 'Mono, multi trigger']]),
      SEL('voice.priority', 'Note priority', [['last', 'Last'], ['low', 'Low'], ['high', 'High']]),
      SEL('voice.maxVoices', 'Polyphony', [[6, '6 voices (MOSS-TRI)'], [12, '12 voices'], [16, '16 voices']], { num: true }),
      SEL('voice.unison', 'Unison', [[1, 'Off'], [2, '2 voices'], [3, '3 voices'], [6, '6 voices']], { num: true }),
      S('voice.uniDetune', 'Unison detune', 0, 99), S('voice.random', 'Random pitch', 0, 99), TOG('voice.hold', 'Hold'), S('voice.tempo', 'Tempo (LFO sync)', 40, 240, { fmt: v => v + ' bpm' })] },
    { title: 'Portamento', controls: [TOG('voice.porta', 'On'), TOG('voice.portaFingered', 'Fingered (legato only)'), S('voice.portaTime', 'Time', 0, 99)] },
    { title: 'Joystick pitch bend', controls: [S('voice.bendUp', 'JS +X', -60, 24, { fmt: F.semis }), S('voice.bendDown', 'JS \u2212X', -60, 24, { fmt: F.semis }),
      SEL('voice.bendStepUp', 'Step +X', BEND_STEPS, { num: true }), SEL('voice.bendStepDown', 'Step \u2212X', BEND_STEPS, { num: true })],
      help: 'Step: the bend moves in steps of that size instead of gliding. Reed and Brass oscillators also have Jump bend (semitone jumps, like overblowing).' },
    { title: 'Output', controls: [S('out.level', 'Output level', 0, 127), S('out.pan', 'Pan', 0, 127, { fmt: F.pan })],
      help: 'MIDI CC 70 to 76 and 79 work as on the EXB-MOSS: sustain level, resonance, release, attack, cutoff, decay, LFO speed and filter EG intensity.' },
    { title: 'Program memory', custom: renderMemory }
  ].concat(patch.korgInfo ? [{ title: 'Imported from ' + (patch.korgInfo && /Bank F/.test(patch.korgInfo.source || '') ? 'Triton' : 'Trinity'), custom: renderImportInfo }] : []);
}
function pageOsc(i) {
  const O = patch.osc[i], base = 'osc.' + i, pp = base + '.p.', t = O.type, other = i === 0 ? 'OSC 2' : 'OSC 1';
  const dbl = i === 1 && DOUBLE.includes(patch.osc[0].type);
  const types = i === 0 ? OSC_TYPES : OSC_TYPES.slice(0, 9);
  const secs = [
    { title: 'Oscillator ' + (i + 1), note: dbl ? 'Unavailable while OSC 1 uses a double-size model' : '', controls: [
      SEL(base + '.type', 'Type', types, { rerender: true }),
      S(base + '.octave', 'Octave', -2, 1, { fmt: F.oct }), S(base + '.transpose', 'Transpose', -12, 12, { fmt: F.sgn }),
      S(base + '.tune', 'Tune', -50, 50, { fmt: F.cents }), S(base + '.foffset', 'Frequency offset', -10, 10, { step: 0.1, fmt: F.hzOff })] }
  ];
  if (t === 'standard') {
    secs.push({ title: 'Wave', controls: [SEL(pp + 'wave', 'Main wave', [['saw', 'Saw'], ['pulse', 'Pulse']]), S(pp + 'level', 'Level', 0, 99), S(pp + 'edge', 'Wave edge', 0, 99),
      S(pp + 'tri', 'Triangle level', 0, 99), S(pp + 'sine', 'Sine level', 0, 99), S(pp + 'phase', 'Triangle/sine phase', -99, 99, { fmt: F.sgn })] });
    secs.push({ title: 'Waveform modulation', controls: [S(pp + 'wform', 'Waveform', -99, 99, { fmt: F.sgn }), SEL(pp + 'wfLfo', 'LFO', LFO_OPTS), S(pp + 'wfInt', 'LFO intensity', -99, 99, { fmt: F.sgn })],
      help: 'Saw: +99 doubles the frequency. Pulse: 0 is a square wave and \u00b199 is silent. Triangle: bends through ramp and trapezoid shapes.' });
    secs.push({ title: 'Wave shape', controls: [SEL(pp + 'shType', 'Table', [['clip', 'Clip'], ['reso', 'Reso']]), S(pp + 'shIn', 'Input', 0, 99), S(pp + 'shOffset', 'Offset', -99, 99, { fmt: F.sgn }),
      S(pp + 'shShape', 'Shape', 0, 99), S(pp + 'shBal', 'Balance', 0, 99)], help: 'Balance 0 bypasses the shaper; 99 is fully shaped.' });
  } else if (t === 'comb') {
    const burst = O.p.cIn === 'pulse' || O.p.cIn === 'impulse';
    secs.push({ title: 'Comb input', controls: [SEL(pp + 'cIn', 'Input', [['osc', other + ' + noise'], ['sub', 'Sub OSC + noise'], ['f1', 'Filter 1 + noise'], ['f2', 'Filter 2 + noise'], ['pulse', 'Pulse noise'], ['impulse', 'Impulse']], { rerender: true }),
      S(pp + 'cLevel', 'Input level', 0, 99), burst ? S(pp + 'cPw', 'Pulse width', 0, 99) : S(pp + 'cNoise', 'Noise level', 0, 99)],
      help: burst ? 'Pulse noise and impulse fire once at each note-on, like a pluck.' : 'The noise comes from the noise generator, so its filter colours the comb.' });
    secs.push({ title: 'Comb filter', controls: [S(pp + 'cFb', 'Feedback', 0, 99), S(pp + 'cDamp', 'High damp', 0, 99)] });
  } else if (t === 'vpm') {
    const ext = ['osc', 'sub', 'f1', 'f2'].includes(O.p.vMod);
    secs.push({ title: 'Carrier', controls: [SEL(pp + 'vCar', 'Wave', CAR_OPTS), S(pp + 'vCarLvl', 'Level', 0, 99), S(pp + 'vShape', 'Wave shape', 0, 99),
      SEL(pp + 'vType', 'Shape type', [[1, 'Type 1'], [2, 'Type 2 (rounded)']], { num: true }), S(pp + 'vFb', 'Feedback', 0, 99)] });
    const mc = [SEL(pp + 'vMod', 'Wave', CAR_OPTS.concat([['osc', other], ['sub', 'Sub OSC'], ['f1', 'Filter 1'], ['f2', 'Filter 2']]), { rerender: true }), S(pp + 'vModLvl', 'Level', 0, 99)];
    if (!ext) mc.push(S(pp + 'vRatio', 'Coarse ratio', 0, 16, { fmt: F.ratio }), S(pp + 'vFine', 'Fine', -50, 50, { fmt: F.cents }));
    secs.push({ title: 'Modulator', controls: mc });
  } else if (t === 'reso') {
    const warn = patch.osc[0].type === 'reso' && patch.osc[1].type === 'reso' && patch.osc[0].p.rIn === 'osc' && patch.osc[1].p.rIn === 'osc';
    secs.push({ title: 'Input', controls: [SEL(pp + 'rIn', 'Input', [['osc', other], ['sub', 'Sub OSC'], ['noise', 'Noise'], ['f1', 'Filter 1'], ['f2', 'Filter 2']], { rerender: true }), S(pp + 'rLevel', 'Level', 0, 99)],
      help: warn ? 'Both oscillators feed each other here, which is unstable on the original too and may go silent.' : '' });
    for (let b = 0; b < 4; b++) secs.push({ title: 'Band-pass ' + (b + 1), controls: [S(pp + 'r' + b + 'Lvl', 'Level', 0, 99), S(pp + 'r' + b + 'Harm', 'Harmonic', 1, 16), S(pp + 'r' + b + 'Fine', 'Fine', -99, 99, { fmt: F.sgn }), S(pp + 'r' + b + 'Reso', 'Resonance', 0, 99)] });
  } else if (t === 'ring' || t === 'cross' || t === 'sync') {
    const c = [SEL(pp + 'mIn', t === 'sync' ? 'Master (input)' : 'Modulator (input)', [['osc', other], ['sub', 'Sub OSC'], ['noise', 'Noise'], ['f1', 'Filter 1'], ['f2', 'Filter 2']]),
      SEL(pp + 'mCar', t === 'sync' ? 'Slave wave' : 'Carrier wave', CAR_OPTS), S(pp + 'mEdge', 'Wave edge', 0, 99)];
    if (t !== 'sync') c.push(S(pp + 'mDepth', 'Depth', 0, 99));
    if (t === 'ring') c.push(SEL(pp + 'mType', 'Type', [[1, 'Type 1'], [2, 'Type 2 (brighter)']], { num: true }));
    secs.push({ title: { ring: 'Ring modulation', cross: 'Cross modulation', sync: 'Sync modulation' }[t], controls: c,
      help: t === 'sync' ? 'The slave runs at this oscillator\u2019s pitch and restarts on each cycle of the master. Sweep it with the Mod page destination \u201cOSC ' + (i + 1) + ': slave pitch\u201d.' : '' });
  } else if (t === 'bowed') {
    secs.push({ title: 'Bow speed', controls: [SEL(pp + 'bwSpdEg', 'Speed EG', EG_OPTS), S(pp + 'bwSpdInt', 'EG intensity', -99, 99, { fmt: F.sgn }), TOG(pp + 'bwDiff', 'Differential (bow with a controller\u2019s movement)')],
      help: 'Speed follows the EG; negative intensity bows the other way. Modulate it on the Mod page (\u201cOSC 1: bow speed\u201d).' });
    secs.push({ title: 'Bow pressure', controls: [SEL(pp + 'bwPrsEg', 'Pressure EG', EG_OPTS), S(pp + 'bwPrsInt', 'EG intensity', -99, 99, { fmt: F.sgn }), S(pp + 'bwRosin', 'Rosin', 0, 99)] });
    secs.push({ title: 'String', controls: [S(pp + 'bwPos', 'Bowing point', 0, 99), S(pp + 'bwDamp', 'Damping', 0, 99), S(pp + 'bwDampKey', 'Damping track key', 0, 127, { fmt: F.note }),
      S(pp + 'bwDampLo', 'Damping ramp low', -99, 99, { fmt: F.sgn }), S(pp + 'bwDampHi', 'Damping ramp high', -99, 99, { fmt: F.sgn }), S(pp + 'bwDisp', 'Dispersion', 0, 99), S(pp + 'bwRefl', 'Bridge reflection', 0, 99)] });
    secs.push({ title: 'Peaking EQ', controls: [S(pp + 'bwEqF', 'Frequency', 0, 49), S(pp + 'bwEqQ', 'Q', 0, 29), S(pp + 'bwEqG', 'Gain', -18, 18, { fmt: F.sgn })] });
  } else if (t === 'reed') {
    secs.push({ title: 'Instrument', controls: [SEL(pp + 'rdType', 'Inst type', REED_TYPES, { num: true }), SEL(pp + 'rdJump', 'Jump bend', [[0, 'Off (smooth)'], [1, 'JS +X'], [2, 'JS \u2212X'], [3, 'Both']], { num: true }), SEL(pp + 'rdPrsEg', 'Pressure EG', EG_OPTS), S(pp + 'rdPrsInt', 'EG intensity', -99, 99, { fmt: F.sgn }), S(pp + 'rdNoise', 'Breath noise', 0, 99)],
      help: 'Breath noise comes from the noise generator, so its filter shapes the breath. Pressure near zero is silent; more pressure plays louder and brighter.' });
    secs.push({ title: 'Tone', controls: [S(pp + 'rdHpf', 'High-pass', 0, 99), S(pp + 'rdHpfReso', 'High-pass resonance', 0, 99), SEL(pp + 'rdWsTable', 'Shape table', [['clip', 'Clip'], ['reso', 'Reso']]),
      S(pp + 'rdWsOff', 'Shape offset', -99, 99, { fmt: F.sgn }), S(pp + 'rdWsShape', 'Shape', 0, 99)] });
    secs.push({ title: 'Peaking EQ', controls: [S(pp + 'rdEqF', 'Frequency', 0, 49), S(pp + 'rdEqQ', 'Q', 0, 29), S(pp + 'rdEqG', 'Gain', -18, 18, { fmt: F.sgn })] });
  } else if (t === 'pluck') {
    secs.push({ title: 'Attack', controls: [S(pp + 'plAtk', 'Attack level', 0, 99), S(pp + 'plAtkVel', 'Level velocity', -99, 99, { fmt: F.sgn }), S(pp + 'plUp', 'Curve up', 0, 99), S(pp + 'plUpVel', 'Curve up velocity', -99, 99, { fmt: F.sgn }),
      S(pp + 'plDn', 'Curve down', 0, 99), S(pp + 'plDnVel', 'Curve down velocity', -99, 99, { fmt: F.sgn }), S(pp + 'plNoise', 'Noise level', 0, 99), S(pp + 'plNoiseVel', 'Noise velocity', -99, 99, { fmt: F.sgn })] });
    secs.push({ title: 'String', controls: [S(pp + 'plPos', 'String position', 0, 99), S(pp + 'plDisp', 'Dispersion', 0, 99), S(pp + 'plDamp', 'Damping', 0, 99), S(pp + 'plDampKt', 'Damping key track', -99, 99, { fmt: F.sgn }),
      S(pp + 'plDecay', 'Decay', 0, 99), S(pp + 'plDecayKt', 'Decay key track', -99, 99, { fmt: F.sgn }), S(pp + 'plRel', 'Release', 0, 99), S(pp + 'plHarm', 'Harmonics point', 0, 99)],
      help: 'Harmonics point is where the string is lightly touched (50 is the middle: the octave harmonic). How firmly it is touched comes from the Mod page destination \u201cOSC 1: harmonics\u201d, for example an EG for a harmonic at the attack.' });
    secs.push({ title: 'Pickup and EQ', controls: [TOG(pp + 'plPickup', 'Pickup'), S(pp + 'plPickPos', 'Pickup position', 0, 99), S(pp + 'plEqF', 'Low EQ frequency', 0, 49), S(pp + 'plEqG', 'Low EQ gain', -18, 18, { fmt: F.sgn }), S(pp + 'plBoost', 'Low boost', 0, 99)] });
  } else if (t === 'organ') {
    for (let k = 0; k < 3; k++) secs.push({ title: 'Drawbar ' + (k + 1), controls: [SEL(pp + 'og' + k + 'Wave', 'Wave', ORGAN_WAVES, { num: true }), S(pp + 'og' + k + 'Harm', 'Harmonic', 1, 16, { fmt: fmtHarm }),
      S(pp + 'og' + k + 'Fine', 'Fine', -99, 99, { fmt: F.cents }), S(pp + 'og' + k + 'Lvl', 'Level', 0, 99), S(pp + 'og' + k + 'Perc', 'Percussion', 0, 99)],
      help: k === 0 ? 'Harmonic 1 sounds one octave below the oscillator, so 2 is the oscillator\u2019s own pitch. Footages assume the oscillator is at 8\u2032. Mod page: \u201cOSC ' + (i + 1) + ': drawbar 1 level\u201d.' : '' });
    secs.push({ title: 'Percussion', controls: [SEL(pp + 'ogTrig', 'Trigger', [[0, 'Single'], [1, 'Multi']], { num: true }), S(pp + 'ogDecay', 'Decay', 0, 99)],
      help: 'Multi strikes the percussion on every note. Single strikes it only on a note played with no other key held (notes of a chord struck together all get it). The percussion level AMS on the Mod page (\u201cpercussion level\u201d) scales each drawbar\u2019s percussion.' });
  } else if (t === 'epiano') {
    secs.push({ title: 'Hammer', controls: [S(pp + 'epForce', 'Force', 0, 99), S(pp + 'epCurve', 'Force velocity curve', -1, 99, { fmt: v => v < 0 ? 'Off' : String(v) }), S(pp + 'epWidth', 'Hammer width', 0, 99), S(pp + 'epClick', 'Click level', 0, 99)],
      help: 'More force hits the tine harder: brighter and louder. Higher width means a narrower hammer: a sharper tone and click.' });
    secs.push({ title: 'Tone generator', controls: [S(pp + 'epDecay', 'Decay', 0, 99), S(pp + 'epRel', 'Release', 0, 99), S(pp + 'epOtL', 'Overtone level', 0, 99),
      S(pp + 'epOtF', 'Overtone freq', 0, 99, { fmt: v => '\u00d7' + (Math.pow(2, 1 + 2 * v / 99)).toFixed(2) }), S(pp + 'epOtD', 'Overtone decay', 0, 99)],
      help: 'Decay and Release are the tine\u2019s own ring and damper; they only show when the Amp EG is longer. The overtone is inharmonic, which gives the bell.' });
    secs.push({ title: 'Pickup and EQ', controls: [S(pp + 'epPos', 'Pickup position', 0, 99), S(pp + 'epEqF', 'Low EQ frequency', 0, 49), S(pp + 'epEqG', 'Low EQ gain', -18, 18, { fmt: F.sgn })],
      help: 'Low settings centre the pickup on the tine: the 2nd partial takes over and the fundamental fades. Higher settings bring the fundamental in.' });
  } else if (t === 'brass') {
    secs.push({ title: 'Instrument', controls: [SEL(pp + 'brType', 'Inst type', BRASS_TYPES, { num: true }), SEL(pp + 'brJump', 'Jump bend', [[0, 'Off (smooth)'], [1, 'JS +X'], [2, 'JS \u2212X'], [3, 'Both']], { num: true }), SEL(pp + 'brPrsEg', 'Pressure EG', EG_OPTS), S(pp + 'brPrsInt', 'EG intensity', -99, 99, { fmt: F.sgn }), S(pp + 'brNoise', 'Breath noise', 0, 99)],
      help: 'More pressure plays louder and brighter. Breath noise comes from the noise generator, so its filter shapes the breath. Mod page: \u201cOSC 1: pressure\u201d.' });
    secs.push({ title: 'Lips and bell', controls: [S(pp + 'brLip', 'Lip character', 0, 99), S(pp + 'brBell', 'Bell tone', 0, 99), S(pp + 'brBellRes', 'Bell resonance', 0, 99), S(pp + 'brStr', 'Strength', 0, 99)],
      help: 'Higher lip character is firmer, harder blowing. Higher bell tone removes the low end. Strength overdrives the tone.' });
    secs.push({ title: 'Peaking EQ', controls: [S(pp + 'brEqF', 'Frequency', 0, 49), S(pp + 'brEqQ', 'Q', 0, 29), S(pp + 'brEqG', 'Gain', -18, 18, { fmt: F.sgn })] });
  }
  return secs;
}
function pageSubNoise() {
  return [
    { title: 'Sub oscillator', controls: [SEL('sub.wave', 'Wave', CAR_OPTS), S('sub.octave', 'Octave', -2, 1, { fmt: F.oct }), S('sub.transpose', 'Transpose', -12, 12, { fmt: F.sgn }), S('sub.tune', 'Tune', -50, 50, { fmt: F.cents }), S('sub.foffset', 'Frequency offset', -10, 10, { step: 0.1, fmt: F.hzOff })] },
    { title: 'Noise generator', controls: [SEL('noise.ftype', 'Filter', [['thru', 'Thru'], ['lpf', 'Low pass'], ['hpf', 'High pass'], ['bpf', 'Band pass']]), S('noise.trim', 'Input trim', 0, 99), S('noise.freq', 'Cutoff', 0, 99, { fmt: F.hz }), S('noise.reso', 'Resonance', 0, 99)] }
  ];
}
function pageMixer() {
  return [0, 1].map(b => ({ title: 'Mixer ' + (b + 1), note: b === 1 && patch.filt.routing === 'serial2' ? 'Not used with Serial 2 routing' : '',
    controls: [S('mix.' + b + '.osc1', 'OSC 1', 0, 99), S('mix.' + b + '.osc2', 'OSC 2', 0, 99), S('mix.' + b + '.sub', 'Sub OSC', 0, 99), S('mix.' + b + '.noise', 'Noise', 0, 99), S('mix.' + b + '.fb', 'Feedback', 0, 99)],
    help: b === 1 ? 'Feedback returns the amp output to the mixer. High settings distort, as on the original.' : '' }));
}
function pageFilter() {
  const secs = [{ title: 'Routing', controls: [SEL('filt.routing', 'Routing', [['parallel', 'Parallel'], ['serial1', 'Serial 1'], ['serial2', 'Serial 2']], { rerender: true }), TOG('filt.link', 'Link Filter 2 to Filter 1', { rerender: true })],
    help: ROUTING_HELP[patch.filt.routing] }];
  for (let f = 0; f < 2; f++) {
    if (f === 1 && patch.filt.link) { secs.push({ title: 'Filter 2', note: 'Linked to Filter 1', controls: [] }); continue; }
    const b = 'f.' + f + '.', F2 = patch.f[f];
    const c = [SEL(b + 'type', 'Type', [['lpf', 'Low pass'], ['hpf', 'High pass'], ['bpf', 'Band pass'], ['brf', 'Band reject'], ['dbpf', 'Dual band pass']], { rerender: true }),
      S(b + 'trimA', 'A trim', 0, 99), S(b + 'freqA', 'A cutoff', 0, 99, { fmt: F.hz }), S(b + 'resoA', 'A resonance', 0, 99)];
    if (F2.type === 'dbpf') { c.push(S(b + 'trimB', 'B trim', 0, 99), S(b + 'freqB', 'B cutoff', 0, 99, { fmt: F.hz }), S(b + 'resoB', 'B resonance', 0, 99)); if (F2.egIntB !== undefined) c.push(S(b + 'egIntB', 'B EG intensity', -99, 99, { fmt: F.sgn })); }
    c.push(SEL(b + 'eg', 'Cutoff EG', EG_OPTS), S(b + 'egInt', 'EG intensity', -99, 99, { fmt: F.sgn }),
      S(b + 'keyLow', 'Key low', 0, 127, { fmt: F.note }), S(b + 'keyHigh', 'Key high', 0, 127, { fmt: F.note }), S(b + 'rampLow', 'Ramp low', -99, 99, { fmt: F.sgn }), S(b + 'rampHigh', 'Ramp high', -99, 99, { fmt: F.sgn }));
    secs.push({ title: 'Filter ' + (f + 1), controls: c, help: f === 0 ? 'Keyboard tracking: Ramp low \u221250 and Ramp high +50 follow the pitch exactly. Resonance at 99 self-oscillates once a note excites it.' : '' });
  }
  return secs;
}
function pageAmp() {
  const secs = [0, 1].map(a => ({ title: 'Amp ' + (a + 1), controls: [S('amp.' + a + '.level', 'Level', 0, 99), SEL('amp.' + a + '.eg', 'EG', EG_OPTS),
    S('amp.' + a + '.keyLow', 'Key low', 0, 127, { fmt: F.note }), S('amp.' + a + '.keyHigh', 'Key high', 0, 127, { fmt: F.note }), S('amp.' + a + '.rampLow', 'Ramp low', -99, 99, { fmt: F.sgn }), S('amp.' + a + '.rampHigh', 'Ramp high', -99, 99, { fmt: F.sgn })] }));
  secs.push({ title: 'Amp EG', eg: 'ampEG', isAmp: true, controls: DEF_EG('ampEG').concat([S('ampEG.atkL', 'Attack level', 0, 99), S('ampEG.brkL', 'Break level', 0, 99), S('ampEG.susL', 'Sustain level', 0, 99),
    S('ampEG.vel', 'Velocity to level', -99, 99, { fmt: F.sgn }), S('ampEG.velTime', 'Velocity to time', -99, 99, { fmt: F.sgn })]) });
  secs.push({ title: 'Amp EG modulation', controls: EG_MODS('ampEG') });
  return secs;
}
let egSel = 0, lfoSel = 0;
function pageEG() {
  const b = 'eg.' + egSel;
  return [{ title: '', seg: ['EG 1', 'EG 2', 'EG 3', 'EG 4'], segVal: egSel, segSet: v => { egSel = v; renderPage(); }, eg: b,
    controls: [S(b + '.startL', 'Start level', -99, 99, { fmt: F.sgn }), S(b + '.atkL', 'Attack level', -99, 99, { fmt: F.sgn }), S(b + '.brkL', 'Break level', -99, 99, { fmt: F.sgn }), S(b + '.susL', 'Sustain level', -99, 99, { fmt: F.sgn }), S(b + '.relL', 'Release level', -99, 99, { fmt: F.sgn })]
      .concat(DEF_EG(b)).concat([S(b + '.vel', 'Velocity to level', -99, 99, { fmt: F.sgn }), S(b + '.velTime', 'Velocity to time', -99, 99, { fmt: F.sgn })]),
    help: 'Route EGs on the Filter, Amp and Mod pages. Time values are approximate; Korg never published the curves.' },
  { title: 'EG ' + (egSel + 1) + ' modulation', controls: EG_MODS(b), help: 'Level mod scales the levels like velocity does. Time mods follow Korg: +16 on a full source halves the times, +99 makes them 64 times shorter.' }];
}
function pageLFO() {
  const b = 'lfo.' + lfoSel;
  return [{ title: '', seg: ['LFO 1', 'LFO 2', 'LFO 3', 'LFO 4'], segVal: lfoSel, segSet: v => { lfoSel = v; renderPage(); },
    controls: [SEL(b + '.wave', 'Waveform', LFO_WAVES), S(b + '.freq', 'Frequency', 0, 199, { fmt: F.lfo }), S(b + '.offset', 'Offset', -50, 50, { fmt: F.sgn }),
      SEL(b + '.sync', 'Key sync', [['off', 'Off'], ['timbre', 'By timbre'], ['voice', 'By voice']]), S(b + '.fade', 'Fade in', 0, 99, { fmt: F.time })],
    help: 'Key sync by voice restarts each note\u2019s LFO; by timbre restarts all of them when you play from silence.' },
  { title: 'LFO ' + (lfoSel + 1) + ' modulation', controls: [SEL(b + '.fm1', 'Speed mod 1 source', SRC_OPTS), S(b + '.fm1Int', 'Speed mod 1 intensity', -99, 99, { fmt: F.sgn }),
      SEL(b + '.fm2', 'Speed mod 2 source', SRC_OPTS), S(b + '.fm2Int', 'Speed mod 2 intensity', -99, 99, { fmt: F.sgn }),
      SEL(b + '.am', 'Depth source', SRC_OPTS), S(b + '.amInt', 'Depth intensity', -99, 99, { fmt: F.sgn })],
    help: 'Once a depth source is set, the LFO\u2019s depth follows it (as on the Prophecy and Z1), so a joystick can bring vibrato in from nothing.' },
  { title: 'Tempo sync', controls: [TOG(b + '.msync', 'Sync to tempo'), SEL(b + '.mbase', 'Base note', [[0, '1/16'], [1, '1/8 triplet'], [2, '1/8'], [3, '1/4 triplet'], [4, '1/4'], [5, '1/2 triplet'], [6, '1/2'], [7, 'Whole']], { num: true }),
      S(b + '.mtimes', 'Times', 0, 15, { fmt: v => '\u00d7' + (v + 1) })],
    help: 'Uses the program tempo on the Program page. One cycle lasts the base note times this number.' }];
}
function pageMod() { return [{ title: 'Modulation', custom: renderMods }]; }
// ---------------- effects (Trinity insert + master effects) ----------------
const FX_MAX_INS = 8;
const FX_CATS = [['delay', 'Delay'], ['reverb', 'Reverb and reflections'], ['mod', 'Chorus, flanger, ensemble'], ['phaser', 'Phaser'], ['trem', 'Tremolo and pan'], ['rot', 'Rotary speaker'],
  ['filt', 'Filter, talking modulator, special'], ['eq', 'EQ'], ['dyn', 'Dynamics'], ['drive', 'Drive, amp, decimator'], ['pitch', 'Pitch']];
const fxSize = id => { const e = TFX.byId(id); return e ? TFX.SIZE[e.grp] : 0; };
let fxSel = 'i0';
function fxTypeSelect(cur, groups, onPick, label) {
  const s = el('select', 'fxtype'); s.setAttribute('aria-label', label);
  const ce = TFX.byId(cur);
  if (ce && !groups.includes(ce.grp)) { const g = el('optgroup'); g.label = 'Set by the imported program'; const o = el('option', null, ce.name + '  \u00b7 size ' + (TFX.SIZE[ce.grp] || '-')); o.value = ce.id; g.appendChild(o); s.appendChild(g); }
  for (const [core, cname] of FX_CATS) {
    const list = TFX.CAT.filter(e => groups.includes(e.grp) && e.core === core); if (!list.length) continue;
    const g = el('optgroup'); g.label = cname;
    list.forEach(e => { const o = el('option', null, e.name + (e.master ? '' : '  · size ' + TFX.SIZE[e.grp])); o.value = e.id; g.appendChild(o); });
    s.appendChild(g);
  }
  s.value = cur; s.addEventListener('change', () => onPick(s.value)); return s;
}
// one parameter of an effect, from the catalog: [key, label, min, max, default, unit, log] or [key, label, 'sel'|'src', options, default]
function fxCtl(path, q) {
  const [key, label, a, b, , unit, lg] = q, cur = getP(path + '.' + key);
  const w = el('label', 'ctl'), nm = el('span', 'nm', label);
  if (a === 'sel' || a === 'src') {
    const opts = a === 'src' ? TFX.SRC_NAMES : b, sEl = el('select');
    opts.forEach((t, i) => { const o = el('option', null, t); o.value = i; sEl.appendChild(o); });
    sEl.value = String(Math.round(cur === undefined || cur === null ? (q[4] || 0) : cur));
    sEl.addEventListener('change', () => setP(path + '.' + key, Number(sEl.value)));
    w.append(nm, el('span'), sEl); return w;
  }
  const span = b - a, whole = Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(q[4]);
  const step = unit === 's' ? 0.1 : unit === 'dB' ? 0.5 : unit === 'ms' && span <= 60 ? 0.1 : whole ? 1 : span <= 2 ? 0.01 : span <= 20 ? 0.1 : 1;
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0, out = el('output'), inp = el('input');
  const erPan = /^er\dp$/.test(key), tapPan = /^(p\d|pan\d)$/.test(key);
  const fmt = v => {
    if (unit === 'note') return F.note(Math.round(v));
    if (erPan) return ['L', '1', '2', 'C', '4', '5', 'R'][Math.round(v)] || String(v);
    if (tapPan) { const r = Math.round(v); return r === 0 ? 'C' : r < 0 ? 'L' + -r : 'R' + r; }
    const t = lg ? (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(2) : v.toFixed(1)) : (+v).toFixed(dec);
    return (a < 0 && v > 0 ? '+' : '') + t + (unit ? (unit === '%' || unit === '°' ? '' : ' ') + unit : '');
  };
  inp.type = 'range';
  const toPos = v => lg ? Math.round(Math.log(v / a) / Math.log(b / a) * 1000) : v, fromPos = x => lg ? a * Math.pow(b / a, x / 1000) : x;
  if (lg) { inp.min = 0; inp.max = 1000; inp.step = 1; } else { inp.min = a; inp.max = b; inp.step = step; }
  const v0 = cur === undefined ? q[4] : cur; inp.value = toPos(v0); out.textContent = fmt(v0);
  const put = v => { v = Math.max(a, Math.min(b, v)); if (!lg) v = Math.round(v / step) * step; v = +v.toFixed(4); setP(path + '.' + key, v); out.textContent = fmt(v); return v; };
  inp.addEventListener('input', () => put(fromPos(Number(inp.value))));
  inp.addEventListener('dblclick', () => { const v = put(q[4]); inp.value = toPos(v); });
  w.title = 'Double-click to reset'; w.append(nm, out, inp); return w;
}
function fxParams(host, path, id, master) {
  const e = TFX.byId(id); if (!e) return;
  const g = el('div', 'grid'); e.params.forEach(q => g.appendChild(fxCtl(path + '.p', q))); host.appendChild(g);
  // every Trinity effect's Wet/Dry (a master effect's level) can follow a dynamic-modulation source
  const m = el('div', 'fxmod');
  m.appendChild(fxCtl(path + '.p', ['wsrc', master ? 'Level mod source' : 'Wet/dry mod source', 'src', null, 0]));
  m.appendChild(fxCtl(path + '.p', ['wamt', master ? 'Level mod amount' : 'Wet/dry mod amount', -100, 100, 0, '']));
  host.appendChild(m);
}
// controllers that the program's effects listen to but that have no control on screen: sliders that send their MIDI CC
const FX_SRC_CC = { 15: [82, 1], 16: [4], 17: [64, 1], 18: [7], 19: [10], 20: [11], 21: [12], 22: [13], 23: [18], 24: [19], 26: [17], 27: [20], 28: [21], 29: [17], 30: [19], 31: [20], 32: [21], 33: [65, 1], 34: [66, 1], 35: [83] };
const fxCC = {};
function fxSourcesUsed() {
  const fx = patch.fx, used = new Set(), look = p => { if (!p) return; for (const k of ['src', 'wahSrc', 'spdSrc', 'hsrc', 'wsrc']) if (p[k] > 0) used.add(Math.round(p[k])); };
  fx.ins.forEach(sl => sl && sl.on && look(sl.p)); if (fx.m1.on) look(fx.m1.p); if (fx.m2.on) look(fx.m2.p);
  return [...used].filter(i => FX_SRC_CC[i]).sort((x, y) => x - y);
}
function renderFxControllers(host) {
  const g = el('div', 'grid');
  for (const i of fxSourcesUsed()) {
    const [cc, sw] = FX_SRC_CC[i], name = TFX.SRC_NAMES[i];
    if (sw) {
      const w = el('label', 'tog'), c = el('input'); c.type = 'checkbox'; c.checked = (fxCC[cc] || 0) >= 64;
      c.addEventListener('change', () => { fxCC[cc] = c.checked ? 127 : 0; if (!ctx) startAudio(); send({ t: 'cc', c: cc, v: fxCC[cc] }); });
      w.append(c, document.createTextNode(name)); g.appendChild(w);
    } else {
      const w = el('label', 'ctl'), out = el('output', null, String(fxCC[cc] === undefined ? (cc === 7 || cc === 11 ? 127 : cc === 10 ? 64 : 0) : fxCC[cc])), inp = el('input');
      inp.type = 'range'; inp.min = 0; inp.max = 127; inp.value = out.textContent;
      inp.addEventListener('input', () => { fxCC[cc] = Number(inp.value); out.textContent = inp.value; send({ t: 'cc', c: cc, v: fxCC[cc] }); });
      w.append(el('span', 'nm', name), out, inp); g.appendChild(w);
    }
  }
  host.appendChild(g);
}
function fxSetIns(list) { setP('fx.ins', clone(list)); renderPage(); renderFlow(); }
function renderFxRouting(host) {
  const fx = patch.fx, ins = fx.ins, uses = ins.some(sl => sl && sl.type) || !!fx.ifxRoute;
  const box = el('div', 'fxroute');
  const chip = (txt, sub, key, off, cls) => { const c = el('button', 'fxchip' + (cls ? ' ' + cls : '') + (off ? ' off' : '') + (fxSel === key ? ' sel' : '')); c.type = 'button'; c.appendChild(el('b', null, txt)); if (sub) c.appendChild(el('span', null, sub)); if (key) c.addEventListener('click', () => { fxSel = key; renderPage(); }); else c.disabled = true; return c; };
  const arrow = t => el('span', 'fxarr', t || '→');
  const r1 = el('div', 'fxrow');
  r1.append(chip('MOSS', 'voices', null, false, 'src'), arrow());
  ins.forEach((sl, i) => { const e = TFX.byId(sl.type); r1.append(chip('IFX ' + (i + 1), e ? e.name : '?', 'i' + i, !sl.on), arrow()); });
  if (ins.length < FX_MAX_INS) { const add = chip('+', 'add insert', null, false, 'add'); add.disabled = false; add.addEventListener('click', () => { const l = ins.slice(); l.push(TFX.slot('S2:13')); fxSel = 'i' + (l.length - 1); fxSetIns(l); }); r1.append(add, arrow()); }
  r1.append(chip('Pan / width', uses ? 'after inserts' : 'program pan', null), arrow(), chip('EQ', (fx.eqLo || fx.eqHi) ? 'L ' + F.sgn(fx.eqLo) + ' / H ' + F.sgn(fx.eqHi) + ' dB' : 'flat', 'eq'), arrow(), chip('OUT', 'L/R', null, false, 'src'));
  const s1 = uses ? fx.ifxSend1 : fx.send1, s2 = uses ? fx.ifxSend2 : fx.send2;
  const r2 = el('div', 'fxrow sub'), m1 = TFX.byId(fx.m1.type), m2 = TFX.byId(fx.m2.type);
  r2.append(el('span', 'fxarr', '↳ Send 1 ' + s1), chip('Master 1', m1 ? m1.name : '?', 'm1', !fx.m1.on), el('span', 'fxarr', 'Return ' + fx.m1.ret + ' → out' + (fx.m1.cascade ? ', cascade ↓' : '')));
  const r3 = el('div', 'fxrow sub');
  r3.append(el('span', 'fxarr', '↳ Send 2 ' + s2), chip('Master 2', m2 ? m2.name : '?', 'm2', !fx.m2.on), el('span', 'fxarr', 'Return ' + fx.m2.ret + ' → out'));
  box.append(r1, r2, r3); host.appendChild(box);
  // size budget, as on the Trinity
  const used = ins.reduce((t, sl) => t + (sl && sl.type ? fxSize(sl.type) : 0), 0);
  const note = used > 4 || ins.length > 3 ? 'Inserts use size ' + used + ' in ' + ins.length + ' slots. A Trinity program allows 3 inserts with a total size of 4 (a Combination 8 and 8); here you can chain up to ' + FX_MAX_INS + ' of any size.' :
    'Inserts use size ' + used + ' of the Trinity program\u2019s 4 (3 slots). You can chain up to ' + FX_MAX_INS + ' here, of any size.';
  host.appendChild(el('p', 'help', note + ' Tap a block to edit it.'));
}
function renderFxSlot(host) {
  const fx = patch.fx, i = Number(fxSel.slice(1)), sl = fx.ins[i];
  if (!sl) { host.appendChild(el('p', 'help', 'No insert effect selected. Add one with the + block above.')); return; }
  const path = 'fx.ins.' + i, e = TFX.byId(sl.type);
  const bar = el('div', 'fxbar');
  const on = el('label', 'tog'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!sl.on;
  cb.addEventListener('change', () => { setP(path + '.on', cb.checked ? 1 : 0); renderPage(); }); on.append(cb, document.createTextNode('On'));
  bar.appendChild(on);
  bar.appendChild(fxTypeSelect(sl.type, ['S1', 'S2', 'S4'], id => { const l = clone(fx.ins); l[i] = { on: l[i].on, type: id, p: TFX.defaults(id) }; fxSetIns(l); }, 'Insert effect ' + (i + 1) + ' type'));
  const mv = (t, fn, dis) => { const b = el('button', 'hw sm', t); b.type = 'button'; b.disabled = !!dis; b.addEventListener('click', fn); bar.appendChild(b); };
  mv('← Earlier', () => { const l = clone(fx.ins); [l[i - 1], l[i]] = [l[i], l[i - 1]]; fxSel = 'i' + (i - 1); fxSetIns(l); }, i === 0);
  mv('Later →', () => { const l = clone(fx.ins); [l[i + 1], l[i]] = [l[i], l[i + 1]]; fxSel = 'i' + (i + 1); fxSetIns(l); }, i >= fx.ins.length - 1);
  mv('Remove', () => { const l = clone(fx.ins); l.splice(i, 1); fxSel = 'i' + Math.max(0, i - 1); fxSetIns(l); });
  host.appendChild(bar);
  if (e) host.appendChild(el('p', 'help', 'Size ' + TFX.SIZE[e.grp] + (e.grp === 'S1' ? ': mono in and out (the dry sound turns mono too, as on the Trinity).' : ': stereo.') + (sl.type === 'S4:4' ? ' The modulator is a microphone when one is allowed (the button below; the Claude page itself blocks microphones), otherwise the synth itself.' : '')));
  if (sl.type === 'S4:4') { const b = el('button', 'hw', micStream ? 'Microphone on' : 'Use microphone as modulator'); b.type = 'button'; b.addEventListener('click', async () => { await setMic(!micStream); renderPage(); }); host.appendChild(b); }
  fxParams(host, path, sl.type);
}
function renderFxMaster(host, which) {
  const fx = patch.fx, M = fx[which], path = 'fx.' + which, grp = which === 'm1' ? 'MM' : 'MR';
  const bar = el('div', 'fxbar');
  const on = el('label', 'tog'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!M.on;
  cb.addEventListener('change', () => { setP(path + '.on', cb.checked ? 1 : 0); renderPage(); renderFlow(); }); on.append(cb, document.createTextNode('On'));
  bar.append(on, fxTypeSelect(M.type, [grp], id => { const m = clone(M); m.type = id; m.p = TFX.defaults(id); setP(path, m); renderPage(); }, (which === 'm1' ? 'Master effect 1' : 'Master effect 2') + ' type'));
  host.appendChild(bar);
  const g = el('div', 'grid');
  g.appendChild(mkCtl(S(path + '.ret', 'Return', 0, 127)));
  if (which === 'm1') g.appendChild(mkCtl(TOG(path + '.cascade', 'Cascade into Master 2')));
  host.appendChild(g);
  fxParams(host, path, M.type, true);
}
function pageFX() {
  const fx = patch.fx, uses = fx.ins.some(sl => sl && sl.type) || !!fx.ifxRoute;
  if (!/^(i\d|m1|m2|eq)$/.test(fxSel) || (fxSel[0] === 'i' && !fx.ins[Number(fxSel.slice(1))])) fxSel = fx.ins.length ? 'i0' : 'm2';
  const secs = [{ title: 'Routing', custom: renderFxRouting, help: patch.help || '' }];
  if (fxSel[0] === 'i') secs.push({ title: 'Insert effect ' + (Number(fxSel.slice(1)) + 1), custom: renderFxSlot });
  else if (fxSel === 'm1') secs.push({ title: 'Master Effect 1 · modulation', custom: h => renderFxMaster(h, 'm1'), help: 'Mono in, stereo out. It returns only the effect sound; Send 1 sets how much reaches it.' });
  else if (fxSel === 'm2') secs.push({ title: 'Master Effect 2 · reverb and delay', custom: h => renderFxMaster(h, 'm2'), help: 'Mono in, stereo out. It returns only the effect sound; Send 2 sets how much reaches it.' });
  else secs.push({ title: 'Master EQ', controls: [S('fx.eqLo', 'Low gain', -18, 18, { step: 0.5, fmt: v => F.sgn(v) + ' dB' }), S('fx.eqHi', 'High gain', -18, 18, { step: 0.5, fmt: v => F.sgn(v) + ' dB' })], help: 'Gentle shelving EQ on the final output, around ' + (fx.eqLoF || 80) + ' Hz and ' + (fx.eqHiF || 12000) / 1000 + ' kHz. Korg does not publish the exact corner frequencies, so these are estimates.' });
  if (fxSourcesUsed().length) secs.push({ title: 'Controllers used by these effects', custom: renderFxControllers, help: 'These effects follow controllers that have no control on this screen. Move them here, or send the MIDI CC from your keyboard.' });
  secs.push({ title: uses ? 'After the inserts' : 'Program output', controls: uses
    ? [S('fx.ifxPan', 'Pan', 0, 127, { fmt: F.pan }), S('fx.ifxWidth', 'Width', 0, 127), S('fx.ifxSend1', 'Send 1 (to Master 1)', 0, 127), S('fx.ifxSend2', 'Send 2 (to Master 2)', 0, 127)]
    : [S('fx.send1', 'Send 1 (to Master 1)', 0, 127), S('fx.send2', 'Send 2 (to Master 2)', 0, 127)],
    help: uses ? 'With insert effects in use, the pan, width and sends after them apply (the program’s own sends are ignored), as on the Trinity.' : 'With no insert effects, the program’s pan (Program page) and these sends apply.' });
  return secs;
}
const PAGES = { program: ['Program', pageProgram], osc0: ['OSC 1', () => pageOsc(0)], osc1: ['OSC 2', () => pageOsc(1)], subnoise: ['Sub + Noise', pageSubNoise], mixer: ['Mixer', pageMixer],
  filter: ['Filter', pageFilter], amp: ['Amp', pageAmp], eg: ['EG 1\u20134', pageEG], lfo: ['LFO 1\u20134', pageLFO], mod: ['Mod', pageMod], fx: ['Effects', pageFX], scale: ['Scale', pageScale], keys: ['Keyboard', pageKeys] };

// ---------------- Trinity PCM program pages ----------------
// Values are shown as the Trinity shows them (0-99, -99..+99 ...); the dot-separated part is this model's estimate.
const K = {
  n: v => String(v), sgn: v => (v > 0 ? '+' : '') + v,
  time: v => F.time(v),
  cut: v => { const h = PCM.cutHz(v, 48000); return v + ' · ' + (h < 1000 ? Math.round(h) + ' Hz' : (h / 1000).toFixed(1) + ' kHz'); },
  lfo: v => { const h = PCM.lfoHz(v); return v + ' · ' + (h < 10 ? h.toFixed(2) : h.toFixed(1)) + ' Hz'; },
  pint: v => (v >= 0 ? '+' : '') + Number(v).toFixed(2),
  oct: v => ({ '-2': "32'", '-1': "16'", '0': "8'", '1': "4'" })[v], semis: v => (v > 0 ? '+' : '') + v,
  cents: v => (v > 0 ? '+' : '') + v + ' ct', slope: v => (v >= 0 ? '+' : '') + Number(v).toFixed(1),
  delay: v => v < 0 ? 'Key off' : v + ' ms', pan: v => v < 0 ? 'Off' : F.pan(v)
};
const pcmAms = i => KORG_PCM.AMS.map((a, k) => [a, KORG_PCM.AMS_NAME[k]]).slice(0, i === 1 ? 27 : 23);
const MS_OPTS = () => PCM_MS_NAMES.map((n, i) => [i, String(i).padStart(3, '0') + ' ' + n]);
const standinName = id => { const e = pcmMap.ms[id]; if (!e) return 'placeholder';
  if (e.f) return e.s ? 'Korg recording ' + e.f.split('/').pop() + ' (similar)' : 'Korg’s own multisample'; if (e.syn) return 'built-in ' + e.syn + ' wave'; if (/^kit/.test(e.p)) return 'General MIDI ' + e.p.replace('kit_', '') + ' drum set, key ' + e.k; return 'General MIDI ' + (parseInt(e.p.slice(2), 10) + 1) + (e.r ? ' (shifted ' + e.r + ' st)' : ''); };
function pcmPageProgram() {
  const secs = [
    { title: 'Program', controls: [
      { k: 'txt', path: 'name', label: 'Name' },
      SEL('mode', 'Oscillator mode', [['single', 'Single'], ['double', 'Double']], { rerender: true }),
      SEL('voice.mode', 'Key assign', [['poly', 'Poly'], ['monoSingle', 'Mono, legato'], ['monoMulti', 'Mono']]),
      SEL('voice.priority', 'Key priority (mono)', [['last', 'Last'], ['low', 'Low'], ['high', 'High']]),
      TOG('voice.hold', 'Hold'), TOG('voice.piano', 'Poly assign: Piano'),
      S('osc2Vel', 'OSC 2 bottom velocity', 1, 127, { fmt: K.n }),
      SEL('random', 'Random pitch', [[0, 'Off'], [1 / 64, '±1/64'], [1 / 32, '±1/32'], [1 / 16, '±1/16'], [1 / 8, '±1/8'], [1 / 4, '±1/4'], [1 / 2, '±1/2'], [1, '±1']], { num: true })] },
    { title: 'Pitch EG', controls: [S('peg.startL', 'Start level', -99, 99, { fmt: K.sgn }), S('peg.atkT', 'Attack time', 0, 99, { fmt: K.time }), S('peg.atkL', 'Attack level', -99, 99, { fmt: K.sgn }),
      S('peg.decT', 'Decay time', 0, 99, { fmt: K.time }), S('peg.relT', 'Release time', 0, 99, { fmt: K.time }), S('peg.relL', 'Release level', -99, 99, { fmt: K.sgn }),
      S('peg.velT', 'Time by velocity', -99, 99, { fmt: K.sgn }), SEL('peg.tSrc', 'Time A.M. source', pcmAms(0)), S('peg.tInt', 'Time A.M. intensity', -99, 99, { fmt: K.sgn })],
      help: 'Each oscillator sets how far this EG bends its pitch (OSC pages, EG intensity).' }];
  secs.push({ title: 'Program memory', custom: renderMemory });
  secs.push({ title: 'Imported from Trinity', custom: renderImportInfo });
  return secs;
}
function pcmPageOsc(i) {
  const P = patch, b = 'o.' + i + '.', O = P.o[i];
  if (i === 1 && P.mode !== 'double') return [{ title: 'Oscillator 2', note: 'Used only in Double mode', controls: [] }];
  const secs = [];
  secs.push({ title: 'Multisample', controls: [SEL(b + 'msHi', 'High multisample', MS_OPTS(), { num: true, rerender: true }), S(b + 'lvlHi', 'High level', 0, 127, { fmt: K.n }), TOG(b + 'offHi', 'High: offset start'),
    SEL(b + 'msLo', 'Low multisample', MS_OPTS(), { num: true, rerender: true }), S(b + 'lvlLo', 'Low level', 0, 127, { fmt: K.n }), TOG(b + 'offLo', 'Low: offset start'),
    S(b + 'velSplit', 'High from velocity', 1, 127, { fmt: K.n })],
    help: 'Plays: high → ' + standinName(O.msHi) + '; low → ' + standinName(O.msLo) + '.' + (korgPacks ? '' : ' Korg’s own samples are not available.') });
  secs.push({ title: 'Pitch', controls: [S(b + 'octave', 'Octave', -2, 1, { fmt: K.oct }), S(b + 'transpose', 'Transpose', -12, 12, { fmt: K.semis }), S(b + 'tune', 'Tune', -1200, 1200, { fmt: K.cents }),
    S(b + 'delay', 'Delay start', -1, 5000, { fmt: K.delay, step: 2 }), S(b + 'pitch.slope', 'Pitch slope', -1, 2, { fmt: K.slope, step: 0.1 }),
    S(b + 'pitch.egInt', 'Pitch EG intensity', -12, 12, { fmt: K.pint, step: 0.01 }), S(b + 'pitch.egVel', 'EG intensity by velocity', -99, 99, { fmt: K.sgn }),
    SEL(b + 'pitch.egAmsSrc', 'EG intensity A.M.', pcmAms(i)), S(b + 'pitch.egAmsInt', 'EG intensity A.M. amount', -12, 12, { fmt: K.pint, step: 0.01 }),
    S(b + 'pitch.ribbon', 'Ribbon', -12, 12, { fmt: K.semis }), S(b + 'pitch.jsUp', 'Joystick +X', -60, 12, { fmt: K.semis }), S(b + 'pitch.jsDown', 'Joystick −X', -60, 12, { fmt: K.semis }),
    SEL(b + 'pitch.amsSrc', 'Pitch A.M. source', pcmAms(i)), S(b + 'pitch.amsInt', 'Pitch A.M. intensity', -12, 12, { fmt: K.pint, step: 0.01 })] });
  secs.push({ title: 'OSC LFO (vibrato)', controls: [SEL(b + 'lfo.wave', 'Waveform', KORG_PCM.LFOW.map((w, k) => [w, KORG_PCM.LFOW_NAME[k]])), SEL(b + 'lfo.start', 'Start', [['on', 'Note on'], ['off', 'Note off'], ['both', 'On, stops at note off']]),
    TOG(b + 'lfo.sync', 'Key sync'), S(b + 'lfo.freq', 'Frequency', 0, 99, { fmt: K.lfo }), S(b + 'lfo.offset', 'Offset', -99, 99, { fmt: K.sgn }), S(b + 'lfo.delay', 'Delay', 0, 99, { fmt: K.time }), S(b + 'lfo.fade', 'Fade', -99, 99, { fmt: K.sgn }),
    S(b + 'lfo.kbd', 'Speed by key', -99, 99, { fmt: K.sgn }), S(b + 'lfo.jsy', 'Speed by joystick +Y', 0, 99, { fmt: K.n }), SEL(b + 'lfo.fmSrc', 'Speed A.M.', pcmAms(i)), S(b + 'lfo.fmInt', 'Speed A.M. amount', -99, 99, { fmt: K.sgn }),
    S(b + 'pitch.lfoInt', 'Pitch intensity', -12, 12, { fmt: K.pint, step: 0.01 }), S(b + 'lfoPitch.jsy', 'Intensity by joystick +Y', 0, 99, { fmt: K.n }), S(b + 'lfoPitch.at', 'Intensity by aftertouch', 0, 99, { fmt: K.n }),
    SEL(b + 'lfoPitch.amsSrc', 'Intensity A.M.', pcmAms(i)), S(b + 'lfoPitch.amsInt', 'Intensity A.M. amount', -12, 12, { fmt: K.pint, step: 0.01 })] });
  secs.push({ title: 'Pan and sends', controls: [S(b + 'pan', 'Pan', -1, 127, { fmt: K.pan }), SEL(b + 'panSrc', 'Pan A.M.', pcmAms(i)), S(b + 'panInt', 'Pan A.M. amount', -99, 99, { fmt: K.sgn }),
    S(b + 'send1', 'Send 1', 0, 127, { fmt: K.n }), S(b + 'send2', 'Send 2', 0, 127, { fmt: K.n })] });
  return secs;
}
function pcmPageFilter(i) {
  const P = patch, b = 'o.' + i + '.', O = P.o[i];
  if (i === 1 && P.mode !== 'double') return [{ title: 'Filter 2', note: 'Used only in Double mode', controls: [] }];
  const ft = [['lpf', 'Low pass'], ['hpf', 'High pass'], ['bpf', 'Band pass'], ['brf', 'Band reject']];
  const typeSel = k => ({ k: 'sel', path: b + 'ftype.' + k, label: 'Filter ' + 'AB'[k] + ' type', opts: ft, rerender: true });
  const secs = [{ title: 'Filters', controls: [SEL(b + 'route', 'Routing', [['single', 'Single (A)'], ['serial', 'Serial (A then B)'], ['parallel', 'Parallel'], ['thru', 'Through (off)']], { rerender: true }), typeSel(0), typeSel(1)],
    help: 'Cutoff values follow the Trinity; the kHz figures are this model’s estimate (0 ≈ 250 Hz, 99 ≈ 20 kHz).' }];
  [0, 1].forEach(k => {
    if (k === 1 && O.route === 'single') return;
    const f = b + 'f.' + k + '.';
    secs.push({ title: 'Filter ' + 'AB'[k], controls: [S(f + 'cut', 'Cutoff', 0, 99, { fmt: K.cut }), S(f + 'gain', 'Input gain', 0, 99, { fmt: K.n }), S(f + 'reso', 'Resonance', 0, 31, { fmt: K.n }), S(f + 'resoVel', 'Resonance by velocity', -99, 99, { fmt: K.sgn }),
      S(f + 'egInt', 'Filter EG intensity', -99, 99, { fmt: K.sgn }), S(f + 'egVel', 'EG intensity by velocity', -99, 99, { fmt: K.sgn }), S(f + 'lfoInt', 'Filter LFO intensity', -99, 99, { fmt: K.sgn }),
      S(f + 'jsx', 'Joystick X', -99, 99, { fmt: K.sgn }), S(f + 'at', 'Aftertouch', 0, 99, { fmt: K.n }),
      S(f + 'lowKey', 'Key track low key', 0, 127, { fmt: F.note }), S(f + 'highKey', 'Key track high key', 0, 127, { fmt: F.note }), S(f + 'lowRamp', 'Lower ramp', -99, 99, { fmt: K.sgn }), S(f + 'highRamp', 'Higher ramp', -99, 99, { fmt: K.sgn }),
      SEL(f + 'amsSrc', 'Cutoff A.M.', pcmAms(i)), S(f + 'amsInt', 'Cutoff A.M. amount', -99, 99, { fmt: K.sgn })] });
  });
  const e = b + 'feg.';
  secs.push({ title: 'Filter EG', eg: b + 'feg', controls: [S(e + 'startL', 'Start level', -99, 99, { fmt: K.sgn }), S(e + 'atkT', 'Attack time', 0, 99, { fmt: K.time }), S(e + 'atkL', 'Attack level', -99, 99, { fmt: K.sgn }),
    S(e + 'decT', 'Decay time', 0, 99, { fmt: K.time }), S(e + 'brkL', 'Break point level', -99, 99, { fmt: K.sgn }), S(e + 'slpT', 'Slope time', 0, 99, { fmt: K.time }), S(e + 'susL', 'Sustain level', -99, 99, { fmt: K.sgn }),
    S(e + 'relT', 'Release time', 0, 99, { fmt: K.time }), S(e + 'relL', 'Release level', -99, 99, { fmt: K.sgn })] });
  secs.push({ title: 'Filter EG modulation', controls: ['Attack', 'Decay', 'Slope', 'Release'].map((n, k) => S(e + 'kt.' + k, n + ' time by key', -99, 99, { fmt: K.sgn }))
    .concat(['Attack', 'Decay', 'Slope', 'Release'].map((n, k) => S(e + 'vt.' + k, n + ' time by velocity', -99, 99, { fmt: K.sgn })))
    .concat([SEL(e + 'tSrc', 'Time A.M.', pcmAms(i)), S(e + 'tInt', 'Time A.M. amount', -99, 99, { fmt: K.sgn })])
    .concat(['Start', 'Attack', 'Break point'].map((n, k) => S(e + 'lv.' + k, n + ' level by velocity', -99, 99, { fmt: K.sgn })))
    .concat([SEL(b + 'fegAms.src', 'EG intensity A.M.', pcmAms(i)), S(b + 'fegAms.int', 'EG intensity A.M. amount', -99, 99, { fmt: K.sgn })]) });
  const l = b + 'flfo.';
  secs.push({ title: 'Filter LFO', controls: [SEL(l + 'wave', 'Waveform', KORG_PCM.LFOW.map((w, k) => [w, KORG_PCM.LFOW_NAME[k]])), SEL(l + 'start', 'Start', [['on', 'Note on'], ['off', 'Note off'], ['both', 'On, stops at note off']]),
    TOG(l + 'sync', 'Key sync'), S(l + 'freq', 'Frequency', 0, 99, { fmt: K.lfo }), S(l + 'offset', 'Offset', -99, 99, { fmt: K.sgn }), S(l + 'delay', 'Delay', 0, 99, { fmt: K.time }), S(l + 'fade', 'Fade', -99, 99, { fmt: K.sgn }),
    SEL(l + 'fmSrc', 'Speed A.M.', pcmAms(i)), S(l + 'fmInt', 'Speed A.M. amount', -99, 99, { fmt: K.sgn }),
    S(b + 'flfoMod.jsyn', 'Intensity by joystick −Y', 0, 99, { fmt: K.n }), S(b + 'flfoMod.at', 'Intensity by aftertouch', 0, 99, { fmt: K.n }),
    SEL(b + 'flfoMod.amsSrc', 'Intensity A.M.', pcmAms(i)), S(b + 'flfoMod.amsInt', 'Intensity A.M. amount', -99, 99, { fmt: K.sgn })] });
  return secs;
}
function pcmPageAmp(i) {
  const P = patch, b = 'o.' + i + '.', a = b + 'amp.', e = b + 'aeg.';
  if (i === 1 && P.mode !== 'double') return [{ title: 'Amp 2', note: 'Used only in Double mode', controls: [] }];
  return [{ title: 'Amp', controls: [S(a + 'level', 'Level', 0, 127, { fmt: K.n }), S(a + 'vel', 'Level by velocity', -99, 99, { fmt: K.sgn }), S(a + 'at', 'Level by aftertouch', -99, 99, { fmt: K.sgn }),
    SEL(a + 'amsSrc', 'Level A.M.', pcmAms(i)), S(a + 'amsInt', 'Level A.M. amount', -99, 99, { fmt: K.sgn }),
    S(a + 'lowKey', 'Key track low key', 0, 127, { fmt: F.note }), S(a + 'highKey', 'Key track high key', 0, 127, { fmt: F.note }), S(a + 'lowRamp', 'Lower ramp', -99, 99, { fmt: K.sgn }), S(a + 'highRamp', 'Higher ramp', -99, 99, { fmt: K.sgn })] },
  { title: 'Amp EG', eg: b + 'aeg', isAmp: true, controls: [S(e + 'startL', 'Start level', 0, 99, { fmt: K.n }), S(e + 'atkT', 'Attack time', 0, 99, { fmt: K.time }), S(e + 'atkL', 'Attack level', 0, 99, { fmt: K.n }),
    S(e + 'decT', 'Decay time', 0, 99, { fmt: K.time }), S(e + 'brkL', 'Break point level', 0, 99, { fmt: K.n }), S(e + 'slpT', 'Slope time', 0, 99, { fmt: K.time }), S(e + 'susL', 'Sustain level', 0, 99, { fmt: K.n }),
    S(e + 'relT', 'Release time', 0, 99, { fmt: K.time })] },
  { title: 'Amp EG modulation', controls: ['Attack', 'Decay', 'Slope', 'Release'].map((n, k) => S(e + 'kt.' + k, n + ' time by key', -99, 99, { fmt: K.sgn }))
    .concat(['Attack', 'Decay', 'Slope', 'Release'].map((n, k) => S(e + 'vt.' + k, n + ' time by velocity', -99, 99, { fmt: K.sgn })))
    .concat([SEL(e + 'tSrc', 'Time A.M.', pcmAms(i)), S(e + 'tInt', 'Time A.M. amount', -99, 99, { fmt: K.sgn })])
    .concat(['Start', 'Attack', 'Break point'].map((n, k) => S(e + 'lv.' + k, n + ' level by velocity', -99, 99, { fmt: K.sgn }))) }];
}
const PAGES_PCM = { program: ['Program', pcmPageProgram], osc0: ['OSC 1', () => pcmPageOsc(0)], osc1: ['OSC 2', () => pcmPageOsc(1)], filter0: ['Filter 1', () => pcmPageFilter(0)], filter1: ['Filter 2', () => pcmPageFilter(1)],
  amp0: ['Amp 1', () => pcmPageAmp(0)], amp1: ['Amp 2', () => pcmPageAmp(1)], fx: ['Effects', pageFX], scale: ['Scale', pageScale], keys: ['Keyboard', pageKeys] };
// ---------------- Trinity combination pages ----------------
let curTimbre = 0;
const TSTAT = { int: 'On', off: 'Off', ext: 'External', both: 'Both' };
const tPlays = t => !!t && !!t.p && (t.status === 'int' || t.status === 'both') && (t.ch === 16 || t.ch === 0);
const tLabel = (t, k) => 'T' + (k + 1) + ' ' + (t.pLabel || '') + (t.pName ? ' ' + t.pName : '');
const zoneTxt = t => (t.keyBot > 0 || t.keyTop < 127 ? F.note(t.keyBot) + '–' + F.note(t.keyTop) : 'all keys');
function combiStatus() {
  const C = patch, on = C.timbres.filter(tPlays), miss = C.timbres.filter(t => t.status !== 'off' && !t.p && !t.drum), drums = C.timbres.filter(t => t.status !== 'off' && t.drum);
  return 'Combination: ' + on.length + (on.length === 1 ? ' timbre plays' : ' timbres play') + ' from the keyboard' + (miss.length ? '; ' + miss.length + ' use a program not in memory (silent)' : '') + (drums.length ? '; ' + drums.length + ' use a drum program (not supported, silent)' : '') + (C.timbres.some(t => t.from) ? '; some programs come from other loaded files (see the Timbres table)' : '') + '. PCM timbres play stand-in samples.';
}
function renderTimbreTable(host) {
  const wrap = el('div', 'kitwrap'), t = el('table', 'kit'), hd = el('tr');
  ['', 'Program', 'Status', 'MIDI', 'Level', 'Pan', 'Transpose', 'Keys', 'Velocity', 'Insert FX'].forEach(x => hd.appendChild(el('th', null, x))); t.appendChild(hd);
  patch.timbres.forEach((tb, k) => {
    const tr = el('tr', 'trow' + (k === curTimbre ? ' sel' : '') + (tPlays(tb) ? '' : ' dim'));
    const fx = tb.chain >= 0 ? 'chain ' + (tb.chain + 1) : tb.status === 'off' ? '' : 'none';
    ['T' + (k + 1), (tb.pLabel || '') + ' ' + (tb.pName || (tb.drum ? '(drum program, not supported)' : tb.status !== 'off' ? '(not in memory)' : '')) + (tb.from ? ' \u00b7 from ' + tb.from : ''), TSTAT[tb.status] || tb.status, tb.ch === 16 ? 'Global' : 'Ch ' + (tb.ch + 1),
      tb.level, tb.pan === 'prog' ? 'Program' : tb.pan < 0 ? 'Off' : F.pan(tb.pan), sgn(tb.transpose), zoneTxt(tb), tb.velBot + '–' + tb.velTop, fx].forEach(x => tr.appendChild(el('td', null, String(x))));
    tr.tabIndex = 0; tr.title = 'Edit timbre ' + (k + 1);
    const go = () => { curTimbre = k; selectPage('timbre'); };
    tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    t.appendChild(tr);
  });
  wrap.appendChild(t); host.appendChild(wrap);
}
function combiPageMain() {
  return [{ title: 'Combination', controls: [{ k: 'txt', path: 'name', label: 'Name' }] },
    { title: 'Timbres', custom: renderTimbreTable, help: 'Only timbres that are On and on the Global channel (or channel 1) answer the keyboard; a timbre on another MIDI channel waits for that channel, as on the Trinity. Tap a row to edit the timbre.' },
    { title: 'Program memory', custom: renderMemory },
    { title: 'Imported from Trinity', custom: renderImportInfo }];
}
function renderTimbrePick(host) {
  const row = el('div', 'btnrow');
  patch.timbres.forEach((t, k) => { const b = el('button', 'hw sm' + (k === curTimbre ? ' on' : ''), 'T' + (k + 1)); b.type = 'button'; b.setAttribute('aria-pressed', k === curTimbre ? 'true' : 'false'); if (!tPlays(t)) b.style.opacity = '0.55'; b.addEventListener('click', () => { curTimbre = k; renderPage(); renderFlow(); }); row.appendChild(b); });
  host.appendChild(row);
}
// the timbre's program: any program in memory for this file (its own banks, else earlier loaded files; see memoryFor)
function renderTimbreProgram(host) {
  const t = patch.timbres[curTimbre], cb = combiBanks[Math.floor(prog.idx / 128)], set = prog.bank === 'cb' && cb ? cb.set : null;
  const w = el('label', 'ctl'), s = el('select');
  w.append(el('span', 'nm', 'Program'), el('span'), s);
  if (!set) { const o = el('option', null, t.pLabel + ' ' + (t.pName || '')); s.appendChild(o); s.disabled = true; }
  else {
    const fromTxt = src => src !== set ? ' (from ' + src.name + ')' : '';
    for (const L of 'ABCD') { const src = memoryFor(set, L), b = src && pcmBanks.find(x => x.set === src && x.letter === L); if (!b) continue; const g = el('optgroup'); g.label = 'Bank ' + L + fromTxt(src); b.names.forEach((n, i) => { if (b.drum[i]) return; const o = el('option', null, L + pad3(i) + ' ' + n); o.value = 'ABCD'.indexOf(L) + ':' + i; g.appendChild(o); }); s.appendChild(g); }
    const msrc = memoryFor(set, 'M'), mb = msrc && mossOf(msrc);
    if (mb) { const g = el('optgroup'); g.label = 'Bank M (MOSS)' + fromTxt(msrc); mb.names.forEach((n, i) => { const o = el('option', null, 'M' + pad3(i) + ' ' + n); o.value = '4:' + i; g.appendChild(o); }); s.appendChild(g); }
    s.value = t.bank + ':' + t.prog;
    s.addEventListener('change', () => {
      const [bk, pg] = s.value.split(':').map(Number); t.bank = bk; t.prog = pg; timbreProgram(set, t);
      edited = true; lcd(); saveCurrent(); pcmPrepare(patch); send({ t: 'patch', p: clone(patch) }); renderPage(); renderFlow();
    });
  }
  host.appendChild(w);
  if (t.p) {
    const open = el('button', 'hw sm', 'Open this program'); open.type = 'button';
    open.addEventListener('click', () => { const [b, i] = t.pId.split(':'); loadProgram(b, Number(i)); });
    if (t.pId) host.appendChild(open);
  }
}
function combiPageTimbre() {
  const k = curTimbre, t = patch.timbres[k], b = 'timbres.' + k + '.';
  const secs = [{ title: 'Timbre', custom: renderTimbrePick }, { title: 'Timbre ' + (k + 1) + ' program', custom: renderTimbreProgram }];
  const c = [SEL(b + 'status', 'Status', [['int', 'On (INT)'], ['off', 'Off'], ['ext', 'External only'], ['both', 'Both']], { rerender: true }),
    SEL(b + 'ch', 'MIDI channel', [[16, 'Global']].concat([...Array(16)].map((_, i) => [i, 'Channel ' + (i + 1)])), { num: true, rerender: true }),
    S(b + 'level', 'Level', 0, 127, { fmt: K.n })];
  if (typeof t.pan === 'number' && t.pan >= 0) c.push(S(b + 'pan', 'Pan', 0, 127, { fmt: F.pan }));
  c.push(S(b + 'transpose', 'Transpose', -24, 24, { fmt: K.semis }), S(b + 'detune', 'Detune', -99, 99, { fmt: K.cents }));
  if (t.bend !== null && t.bend !== undefined) c.push(S(b + 'bend', 'Pitch bend range', -24, 24, { fmt: K.semis }));
  if (typeof t.send1 === 'number') c.push(S(b + 'send1', 'Send 1', 0, 127, { fmt: K.n }));
  if (typeof t.send2 === 'number') c.push(S(b + 'send2', 'Send 2', 0, 127, { fmt: K.n }));
  c.push(S(b + 'delay', 'Delay start', -1, 5000, { fmt: K.delay, step: 2 }));
  c.push(TOG(b + 'hideOsc2', 'Hide OSC 2 (Double programs)'), TOG(b + 'forcePoly', 'Force poly (Mono programs)'));
  const notes = [];
  if (t.pan === 'prog') notes.push('pan: the program’s'); if (t.bend === null || t.bend === undefined) notes.push('bend range: the program’s');
  if (t.send1 === 'prog' || t.send2 === 'prog') notes.push('sends: the program’s');
  secs.push({ title: 'Mix', controls: c, help: (notes.length ? 'This timbre uses ' + notes.join(', ') + '. ' : '') + (t.chain >= 0 ? 'It plays through insert chain ' + (t.chain + 1) + ' (Effects page), whose sends apply instead of its own.' : 'It has no insert effect.') });
  secs.push({ title: 'Key and velocity zones', controls: [S(b + 'keyBot', 'Lowest key', 0, 127, { fmt: F.note }), S(b + 'keyTop', 'Highest key', 0, 127, { fmt: F.note }),
    S(b + 'keySlopeBot', 'Fade in above lowest key', 0, 72, { fmt: v => v + ' st' }), S(b + 'keySlopeTop', 'Fade out below highest key', 0, 72, { fmt: v => v + ' st' }),
    S(b + 'velBot', 'Lowest velocity', 1, 127, { fmt: K.n }), S(b + 'velTop', 'Highest velocity', 1, 127, { fmt: K.n }),
    S(b + 'velSlopeBot', 'Fade in above lowest velocity', 0, 120, { fmt: K.n }), S(b + 'velSlopeTop', 'Fade out below highest velocity', 0, 120, { fmt: K.n })],
    help: 'The timbre plays only inside its zones; the fades soften it toward each edge.' });
  secs.push({ title: 'MIDI filters', controls: [TOG(b + 'rxDamper', 'Receives the damper (sustain) pedal'), TOG(b + 'rxAT', 'Receives aftertouch'), TOG(b + 'rxCC', 'Receives control changes (joystick Y, knobs, other pedals)')],
    help: 'Switched off, this timbre ignores that message while the other timbres still get it. Pitch bend always reaches every timbre. The Trinity\u2019s program-change filter is kept in the data but this page does not change programs by MIDI.' });
  return secs;
}
function renderCombiRouting(host) {
  const C = patch, box = el('div', 'fxroute');
  const chip = (txt, sub, key, off, cls) => { const c = el('button', 'fxchip' + (cls ? ' ' + cls : '') + (off ? ' off' : '') + (fxSel === key ? ' sel' : '')); c.type = 'button'; c.appendChild(el('b', null, txt)); if (sub) c.appendChild(el('span', null, sub)); if (key) c.addEventListener('click', () => { fxSel = key; renderPage(); }); else c.disabled = true; return c; };
  const arrow = t => el('span', 'fxarr', t || '→');
  (C.chains || []).forEach((ch, c) => {
    const r = el('div', 'fxrow');
    r.append(chip('Chain ' + (c + 1), ch.timbres.map(k => 'T' + (k + 1)).join(' + '), null, false, 'src'), arrow());
    ch.blocks.forEach(k => { const B = C.blocks[k], e = B && TFX.byId(B.type); r.append(chip('IFX ' + (k + 1), e ? e.name : 'unknown', B ? 'b' + k : null, !B || !B.on), arrow()); });
    r.append(chip('Pan / width', F.pan(ch.pan < 0 ? 64 : ch.pan), null), arrow(), chip('OUT', 'send 1: ' + ch.send1 + ', send 2: ' + ch.send2, null, false, 'src'));
    box.appendChild(r);
  });
  const dry = C.timbres.map((t, k) => (t.status !== 'off' && t.chain < 0 ? k : -1)).filter(k => k >= 0);
  if (dry.length) { const r = el('div', 'fxrow'); r.append(chip('No insert', dry.map(k => 'T' + (k + 1)).join(' + '), null, false, 'src'), arrow(), chip('OUT', 'each timbre’s sends', null, false, 'src')); box.appendChild(r); }
  const fx = C.fx, m1 = TFX.byId(fx.m1.type), m2 = TFX.byId(fx.m2.type), r2 = el('div', 'fxrow sub');
  r2.append(el('span', 'fxarr', '↳ Send 1'), chip('Master 1', m1 ? m1.name : '?', 'm1', !fx.m1.on), el('span', 'fxarr', '↳ Send 2'), chip('Master 2', m2 ? m2.name : '?', 'm2', !fx.m2.on), arrow(), chip('EQ', (fx.eqLo || fx.eqHi) ? 'L ' + F.sgn(fx.eqLo) + ' / H ' + F.sgn(fx.eqHi) + ' dB' : 'flat', 'eq'));
  box.appendChild(r2); host.appendChild(box);
  host.appendChild(el('p', 'help', 'A combination has 8 insert effect blocks, shared out as chains to its timbres, and the two master effects. Tap a block to edit it.'));
}
function renderCombiBlock(host) {
  const k = Number(fxSel.slice(1)), B = patch.blocks[k]; if (!B) return;
  const path = 'blocks.' + k, e = TFX.byId(B.type);
  const bar = el('div', 'fxbar'), on = el('label', 'tog'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!B.on;
  cb.addEventListener('change', () => { setP(path + '.on', cb.checked ? 1 : 0); renderPage(); }); on.append(cb, document.createTextNode('On'));
  bar.append(on, el('span', 'nm', e ? e.name + ' (size ' + TFX.SIZE[e.grp] + ')' : B.type)); host.appendChild(bar);
  fxParams(host, path, B.type);
}
function pageCombiFx() {
  const C = patch, first = (C.chains || []).map(ch => ch.blocks.find(k => C.blocks[k])).find(k => k !== undefined);
  if (!/^(b\d|m1|m2|eq)$/.test(fxSel) || (fxSel[0] === 'b' && !C.blocks[Number(fxSel.slice(1))])) fxSel = first !== undefined ? 'b' + first : 'm2';
  const secs = [{ title: 'Routing', custom: renderCombiRouting }];
  if (fxSel[0] === 'b') secs.push({ title: 'Insert effect ' + (Number(fxSel.slice(1)) + 1), custom: renderCombiBlock });
  else if (fxSel === 'm1') secs.push({ title: 'Master Effect 1 · modulation', custom: h => renderFxMaster(h, 'm1'), help: 'Mono in, stereo out. It returns only the effect sound.' });
  else if (fxSel === 'm2') secs.push({ title: 'Master Effect 2 · reverb and delay', custom: h => renderFxMaster(h, 'm2'), help: 'Mono in, stereo out. It returns only the effect sound.' });
  else secs.push({ title: 'Master EQ', controls: [S('fx.eqLo', 'Low gain', -18, 18, { step: 0.5, fmt: v => F.sgn(v) + ' dB' }), S('fx.eqHi', 'High gain', -18, 18, { step: 0.5, fmt: v => F.sgn(v) + ' dB' })] });
  return secs;
}
const PAGES_COMBI = { combi: ['Combination', combiPageMain], timbre: ['Timbre', combiPageTimbre], fx: ['Effects', pageCombiFx], scale: ['Scale', pageScale], keys: ['Keyboard', pageKeys] };
function renderFlowCombi(svg) {
  const C = patch, add = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
  const FX = { x: 356, y: 55, w: 42, h: 40 };
  C.timbres.forEach((t, k) => {
    const x = k < 4 ? 2 : 178, y = 4 + (k % 4) * 37, w = 168, h = 32, live = tPlays(t);
    const g = add('g', { class: 'blk' + (curPage === 'timbre' && curTimbre === k ? ' sel' : '') + (live ? '' : ' dim'), tabindex: 0, role: 'button', 'aria-label': 'Edit timbre ' + (k + 1) });
    add('rect', { x, y, width: w, height: h, rx: 2 }, g);
    add('text', { x: x + 5, y: y + 13, class: 't' }, g).textContent = 'T' + (k + 1) + ' ' + (t.status === 'off' ? 'OFF' : (t.pLabel || ''));
    add('text', { x: x + 5, y: y + 27 }, g).textContent = (t.pName || (t.status === 'off' ? '' : t.drum ? 'DRUMS (SILENT)' : 'NOT IN MEMORY')).toUpperCase().slice(0, 18);
    const go = () => { curTimbre = k; selectPage('timbre'); }; g.addEventListener('click', go); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  const g = add('g', { class: 'blk' + (curPage === 'fx' ? ' sel' : ''), tabindex: 0, role: 'button', 'aria-label': 'Edit effects' });
  add('rect', { x: FX.x, y: FX.y, width: FX.w, height: FX.h, rx: 2 }, g); add('text', { x: FX.x + 5, y: FX.y + FX.h / 2 + 5, class: 't' }, g).textContent = 'FX';
  const go = () => selectPage('fx'); g.addEventListener('click', go); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
}
function PAGESET() { return patch && patch.kind === 'combi' ? PAGES_COMBI : patch && patch.kind === 'pcm' ? PAGES_PCM : PAGES; }
let curPage = store.get('moss-page', 'program'); if (!PAGESET()[curPage]) curPage = Object.keys(PAGESET())[0];

// ---------------- rendering ----------------
function mkCtl(d, onAfter) {
  const val = getP(d.path);
  if (d.k === 's') {
    const w = el('label', 'ctl'), nm = el('span', 'nm', d.label), out = el('output'), inp = el('input');
    const fmt = d.fmt || String;
    inp.type = 'range'; inp.min = d.min; inp.max = d.max; inp.step = d.step; inp.value = val; out.textContent = fmt(val);
    inp.addEventListener('input', () => { const v = Number(inp.value); setP(d.path, v); out.textContent = fmt(v); if (onAfter) onAfter(); });
    inp.addEventListener('dblclick', () => { const dv = defaultAt(d.path); if (dv === undefined) return; inp.value = dv; setP(d.path, dv); out.textContent = fmt(dv); if (onAfter) onAfter(); });
    w.title = 'Double-click to reset';
    w.append(nm, out, inp); return w;
  }
  if (d.k === 'sel') {
    const w = el('label', 'ctl'), nm = el('span', 'nm', d.label), s = el('select');
    for (const o of d.opts) { const op = el('option', null, o[1]); op.value = o[0]; if (o[2]) op.disabled = true; s.appendChild(op); }
    s.value = String(val);
    s.addEventListener('change', () => { const v = d.num ? Number(s.value) : s.value; setP(d.path, v); if (d.rerender) { renderPage(); renderFlow(); } if (onAfter) onAfter(); });
    w.append(nm, el('span'), s); return w;
  }
  if (d.k === 'tog') {
    const w = el('label', 'tog'), c = el('input'); c.type = 'checkbox'; c.checked = !!val;
    c.addEventListener('change', () => { setP(d.path, c.checked ? 1 : 0); if (d.rerender) { renderPage(); renderFlow(); } });
    w.append(c, document.createTextNode(d.label)); return w;
  }
  if (d.k === 'txt') {
    const w = el('label', 'ctl'), nm = el('span', 'nm', d.label), t = el('input'); t.type = 'text'; t.maxLength = 24; t.value = val || '';
    t.addEventListener('input', () => { patch.name = t.value; edited = true; lcd(); saveCurrent(); });
    w.append(nm, el('span'), t); return w;
  }
}
function renderTabs() {
  const host = $('#tabs'); host.innerHTML = '';
  for (const [id, [label]] of Object.entries(PAGESET())) {
    const b = el('button', 'tab', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.id = 'tab-' + id;
    b.setAttribute('aria-selected', String(id === curPage));
    b.addEventListener('click', () => selectPage(id));
    host.appendChild(b);
  }
}
function selectPage(id) { curPage = id; store.set('moss-page', id); renderTabs(); renderPage(); renderFlow(); const t = $('#tab-' + id); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
function renderPage() {
  const host = $('#page'); host.innerHTML = ''; host.setAttribute('aria-labelledby', 'tab-' + curPage);
  if (!PAGESET()[curPage]) curPage = Object.keys(PAGESET())[0];
  const secs = PAGESET()[curPage][1]();
  for (const sec of secs) {
    const s = el('section', 'sec');
    if (sec.title || sec.seg || sec.note) {
      const h = el('h3'); if (sec.title) h.appendChild(document.createTextNode(sec.title));
      if (sec.seg) {
        const g = el('div', 'seg'); g.setAttribute('role', 'group');
        sec.seg.forEach((lab, i) => { const b = el('button', null, lab); b.type = 'button'; b.setAttribute('aria-pressed', String(i === sec.segVal)); b.addEventListener('click', () => sec.segSet(i)); g.appendChild(b); });
        h.appendChild(g);
      }
      if (sec.note) h.appendChild(el('span', 'note', sec.note));
      s.appendChild(h);
    }
    let egSvg = null;
    if (sec.eg) { egSvg = document.createElementNS(SVGNS, 'svg'); egSvg.setAttribute('class', 'egsvg'); egSvg.setAttribute('viewBox', '0 0 360 70'); egSvg.setAttribute('aria-hidden', 'true'); s.appendChild(egSvg); drawEG(egSvg, sec.eg, sec.isAmp); }
    if (sec.custom) sec.custom(s);
    else {
      const g = el('div', 'grid');
      for (const d of sec.controls) g.appendChild(mkCtl(d, egSvg ? () => drawEG(egSvg, sec.eg, sec.isAmp) : null));
      s.appendChild(g);
    }
    if (sec.help) s.appendChild(el('p', 'help', sec.help));
    host.appendChild(s);
  }
}
function drawEG(svg, path, isAmp) {
  const e = getP(path), T = v => 0.12 + Math.log10(1 + MD.tsec(v) * 40);
  const pts = []; let x = 0;
  pts.push([x, isAmp ? 0 : e.startL]); x += T(e.atkT); pts.push([x, e.atkL]); x += T(e.decT); pts.push([x, e.brkL]); x += T(e.slpT); pts.push([x, e.susL]);
  x += 0.9; pts.push([x, e.susL]); x += T(e.relT); pts.push([x, isAmp ? 0 : e.relL]);
  const W = 352, H = 64, sx = W / x, lo = isAmp ? 0 : -99, hi = 99;
  const Y = v => 4 + (hi - v) / (hi - lo) * (H - 4);
  svg.innerHTML = '';
  const z = document.createElementNS(SVGNS, 'line'); z.setAttribute('x1', 4); z.setAttribute('x2', 356); z.setAttribute('y1', Y(0)); z.setAttribute('y2', Y(0)); svg.appendChild(z);
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', pts.map((q, i) => (i ? 'L' : 'M') + (4 + q[0] * sx).toFixed(1) + ' ' + Y(q[1]).toFixed(1)).join(' ')); svg.appendChild(p);
}
function renderMods(host) {
  const box = el('div', 'mods');
  const hd = el('div', 'modrow modhead'); ['', 'Source', 'Via (scales)', 'Destination', 'Amount'].forEach(t => hd.appendChild(el('span', null, t))); box.appendChild(hd);
  const dsts = dstOpts();
  patch.mods.forEach((m, i) => {
    const r = el('div', 'modrow'); r.appendChild(el('span', 'n', String(i + 1)));
    const mk = (key, opts, cls, lab) => { const s = el('select', cls); s.setAttribute('aria-label', 'Slot ' + (i + 1) + ' ' + lab); for (const o of opts) { const op = el('option', null, o[1]); op.value = o[0]; s.appendChild(op); } s.value = m[key]; s.addEventListener('change', () => setP('mods.' + i + '.' + key, s.value)); return s; };
    r.appendChild(mk('src', SRC_OPTS, 'ssel', 'source'));
    r.appendChild(mk('via', [['off', 'Always']].concat(SRC_OPTS.slice(1)), 'vsel', 'via'));
    r.appendChild(mk('dst', dsts, 'dsel', 'destination'));
    const a = el('div', 'amt'), inp = el('input'), out = el('output', null, F.sgn(m.amt));
    inp.type = 'range'; inp.min = -99; inp.max = 99; inp.value = m.amt; inp.setAttribute('aria-label', 'Slot ' + (i + 1) + ' amount');
    inp.addEventListener('input', () => { setP('mods.' + i + '.amt', Number(inp.value)); out.textContent = F.sgn(Number(inp.value)); });
    inp.addEventListener('dblclick', () => { inp.value = 0; setP('mods.' + i + '.amt', 0); out.textContent = '0'; });
    a.append(inp, out); r.appendChild(a); box.appendChild(r);
  });
  host.appendChild(box);
  host.appendChild(el('p', 'help', 'Each slot is one of MOSS\u2019s per-parameter AMS routings. Pitch amounts are curved: 25 is about three-quarters of a semitone and 99 is an octave. \u201cVia\u201d multiplies the route by a second source, such as LFO 1 via JS +Y for joystick vibrato. Mod A and B change meaning with the oscillator type and are named in the destination list.'));
}
function renderMemory(host) {
  const row = el('div', 'btnrow');
  const b = (label, fn) => { const x = el('button', 'hw', label); x.type = 'button'; x.addEventListener('click', fn); row.appendChild(x); return x; };
  const w = inPlace();
  if (w) b('Save in place (' + w.label + ')', saveInPlace);
  b(prog.bank === 'us' ? 'Save to User ' + String(prog.idx + 1).padStart(2, '0') : 'Save to User bank', saveToUser);
  if (w && bankEdits[w.key]) b('Restore original ' + w.label, restoreOriginal);
  if (prog.bank === 'us') b('Save as new', () => { userBank.push(clone(patch)); prog = { bank: 'us', idx: userBank.length - 1 }; commitUser('Saved to User ' + String(prog.idx + 1).padStart(2, '0')); });
  if (prog.bank === 'us' && userBank[prog.idx]) b('Delete from User bank', () => { userBank.splice(prog.idx, 1); prog = { bank: 'st', idx: 0 }; commitUser('Deleted'); loadProgram('st', 0); });
  b('Export or import', () => { $('#dlgtxt').value = JSON.stringify(patch); $('#dlg').showModal(); });
  b('Import Trinity PCG', () => { const f = el('input'); f.type = 'file'; f.accept = '.pcg,.PCG'; f.addEventListener('change', () => { if (f.files && f.files[0]) importPcgFile(f.files[0]); }); f.click(); });
  const cb = prog.bank === 'pm' ? pcgBanks[Math.floor(prog.idx / 128)] : null;
  if (cb && !cb.builtin) b('Remove this Trinity bank', () => {
    pcgBanks.splice(pcgBanks.indexOf(cb), 1); forget(cb);
    // a file that held only this Bank M also leaves the memory
    const ms = triSets.find(s => !s.builtin && s.name === cb.name && !s.combis.length && !pcmBanks.some(b => b.set === s)); if (ms) { removeTriSet(ms); forget(ms); }
    loadProgram('st', 0); toast('Removed ' + cb.name);
  });
  const ts = prog.bank === 'pc' ? (pcmBanks[Math.floor(prog.idx / 128)] || {}).set : prog.bank === 'cb' ? (combiBanks[Math.floor(prog.idx / 128)] || {}).set : null;
  if (ts && !ts.builtin) b('Remove these PCM banks and combinations', () => { removeTriSet(ts); forget(ts); loadProgram('st', 0); toast('Removed ' + ts.name); });
  b('Revert', () => loadProgram(prog.bank, prog.idx));
  host.appendChild(row);
  if (w) host.appendChild(el('p', 'help', 'Save in place keeps your edit as ' + w.label + ' of ' + w.file + ': the bank list and every combination that uses this program play it from now on. Restore original brings back the program from the file.'));
  host.appendChild(el('p', 'help', 'User programs and imported banks live in this browser only. Use Export to keep a copy elsewhere. Importing reads a Trinity PCG file\u2019s Bank M (MOSS) programs, its PCM programs (banks A\u2013D; Drum-mode programs are not supported), its combinations, and its user scale. Korg\u2019s free Trinity preload data can be imported the same way. Like the real synth\u2019s memory, an imported file that lacks some banks uses the ones loaded before it (earlier imports first, then the built-in files); the Timbres table shows where each program comes from.'));
}
function renderImportInfo(host) {
  if (patch.kind === 'combi') {
    const k = patch.korgInfo || {}, lines = [(k.source ? k.source + '. ' : '') + 'Trinity combination: ' + patch.timbres.filter(t => t.status !== 'off').length + ' timbres in use, ' + (patch.chains || []).length + ' insert effect chain' + ((patch.chains || []).length === 1 ? '' : 's') + '.'];
    lines.push('Each timbre plays its program from the same PCG file (banks A\u2013D: PCM programs with stand-in samples; bank M: MOSS). Not modelled yet: a timbre\u2019s own scale (all timbres use the combination\u2019s scale). How the timbres share the insert effects follows the user files; Korg\u2019s documentation of that byte is incomplete.');
    (k.notes || []).forEach(n => lines.push(n + '.'));
    lines.forEach(t => host.appendChild(el('p', 'help', t)));
    return;
  }
  if (patch.kind === 'pcm') {
    const k = patch.korgInfo || {}, lines = [(k.source ? k.source + '. ' : '') + 'Trinity PCM program, ' + { single: 'Single', double: 'Double' }[patch.mode] + ' mode.'];
    patch.o.slice(0, patch.mode === 'double' ? 2 : 1).forEach((O, i) => lines.push('OSC ' + (i + 1) + ': ' + (PCM_MS_NAMES[O.msHi] || 'RAM sample') + ' \u2192 stand-in: ' + standinName(O.msHi < 0x1000 ? O.msHi : (patch.ramMap || {})[O.msHi & 0xfff] || 0) + '.'));
    lines.push('Korg\u2019s sample ROM is not available, so openly licensed General MIDI recordings (MuseScore\u2019s MS General, MIT licence) and built-in waveforms stand in for the multisamples. The program\u2019s own filters, envelopes, LFOs and effects are applied to them.');
    (k.notes || []).forEach(n => lines.push(n + '.'));
    lines.forEach(t => host.appendChild(el('p', 'help', t)));
    return;
  }
  const k = patch.korgInfo || {}, names = { standard: 'Standard', comb: 'Comb Filter', vpm: 'VPM', reso: 'Resonance', ring: 'Ring Mod', cross: 'Cross Mod', sync: 'Sync Mod', organ: 'Organ', epiano: 'E.Piano', brass: 'Brass', reed: 'Reed', pluck: 'Plucked String', bowed: 'Bowed String' };
  const lines = [(k.source ? k.source + '. ' : '') + 'OSC 1: ' + (names[k.osc1] || k.osc1) + (k.osc2 ? ', OSC 2: ' + (names[k.osc2] || k.osc2) : ' (double-size model)') + '.'];
  (k.notes || []).forEach(n => lines.push(n + '.'));
  lines.forEach(t => host.appendChild(el('p', 'help', t)));
}
// saves over the current user program, or adds a new one to the User bank
function saveToUser() {
  if (prog.bank === 'us' && userBank[prog.idx]) userBank[prog.idx] = clone(patch); else { userBank.push(clone(patch)); prog = { bank: 'us', idx: userBank.length - 1 }; }
  commitUser('Saved to User ' + String(prog.idx + 1).padStart(2, '0'));
}
// the current program's place in a Trinity bank (Bank M or a PCM bank), or null when it has none
function inPlace() {
  const i = prog.idx % 128;
  if (prog.bank === 'pm') { const b = pcgBanks[Math.floor(prog.idx / 128)]; return b && i < b.n ? { key: editKeyM(b, i), label: bankLetter(b) + pad3(i), file: b.name, rename: () => { b.names[i] = pcgName(b, i); } } : null; }
  if (prog.bank === 'pc') { const b = pcmBanks[Math.floor(prog.idx / 128)]; return b ? { key: editKeyP(b, i), label: b.letter + pad3(i), file: b.set.name, rename: () => { b.names[i] = pcmName(b, i); } } : null; }
  return null;
}
// saves over the program in its bank (kept apart from the file's bytes, see bankEdits), so combinations use the edit
function saveInPlace() {
  const w = inPlace(); if (!w) return;
  if (!saveEdits(Object.assign({}, bankEdits, { [w.key]: clone(patch) }))) { toast('Could not save: browser storage is unavailable'); return; }
  bankChanged(w); toast('Saved in place: ' + w.label);
}
function restoreOriginal() {
  const w = inPlace(); if (!w) return;
  const all = Object.assign({}, bankEdits); delete all[w.key];
  if (!saveEdits(all)) { toast('Could not save: browser storage is unavailable'); return; }
  bankChanged(w); toast('Restored ' + w.label + ' from ' + w.file);
}
function bankChanged(w) { w.rename(); loadProgram(prog.bank, prog.idx); browsers.forEach(b => b.render()); }
function commitUser(msg) {
  if (!store.set(LS_USER, userBank)) { toast('Could not save: browser storage is unavailable'); return; }
  edited = false;
  refreshProgs(); lcd(); saveCurrent(); renderPage(); toast(msg);
}
$('#dlgcopy').addEventListener('click', async () => {
  const t = $('#dlgtxt'); t.select();
  try { await navigator.clipboard.writeText(t.value); toast('Copied'); } catch (e) { try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Select the text and copy it manually'); } }
});
$('#dlgload').addEventListener('click', () => {
  try {
    const p = JSON.parse($('#dlgtxt').value);
    if (!p || typeof p !== 'object' || !(p.osc || (p.kind === 'pcm' && p.o) || (p.kind === 'combi' && Array.isArray(p.timbres)))) throw new Error('not a program');
    patch = loadAny(p); edited = true; pcmPrepare(patch); if (!PAGESET()[curPage]) curPage = Object.keys(PAGESET())[0];
    send({ t: 'patch', p: clone(patch) }); sendTuning(); renderAll(); saveCurrent(); $('#dlg').close(); toast('Program loaded');
  } catch (e) { toast('That text is not a MOSS program'); }
});
