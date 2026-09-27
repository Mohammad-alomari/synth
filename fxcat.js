// ===== Trinity effect catalog =====
// Algorithm lists, order and parameter byte layout follow Korg's "TRINITY Effects MIDI System Exclusive"
// document (Effect Parameter pages 1-33). Program bytes: Type = index inside its size group, Size 1/2/4.
// Spec strings: "key@chunks@rawMin@rawMax@valMin@valMax[@log]" ; chunks "ofs" (full byte) or "ofs:hi-lo",
// several chunks joined by "," from most to least significant; rawMin > rawMax (hex) means signed.
class TFX {
  static get CAT() {
    if (TFX._cat) return TFX._cat;
    const W = ['wet', 'Wet/dry', 0, 100, 50, '%'], WS = ['wet', 'Wet/dry', -100, 100, 50, '%'], OUT = ['out', 'Output level', 0, 100, 80, ''], OUTS = ['out', 'Output level', -100, 100, 80, ''];
    const LF = ['lfoF', 'LFO frequency', 0.02, 20, 0.5, 'Hz', 1], LW = ['wave', 'LFO waveform', 'sel', ['Triangle', 'Sine'], 0], SH = ['shape', 'LFO shape', -100, 100, 0, ''];
    const PH = ['phase', 'LFO phase', -180, 180, 90, '°'], SP = ['spread', 'Spread', -100, 100, 50, ''], HD = ['hd', 'High damp', 0, 100, 20, '%'], LD = ['ld', 'Low damp', 0, 100, 0, '%'];
    const FB = ['fb', 'Feedback', -100, 100, 30, ''], DP = ['depth', 'Depth', 0, 100, 40, ''], TR = ['trim', 'EQ trim', 0, 100, 100, ''], LO = ['lo', 'Pre low EQ', -15, 15, 0, 'dB'], HI = ['hi', 'Pre high EQ', -15, 15, 0, 'dB'];
    const TEMPO = [['tempo', 'Tempo', 30, 250, 120, 'bpm'], ['len', 'Length', 1, 16, 1, ''], ['lenDiv', 'Length /', 1, 16, 4, '']];
    const T = (ms, key, label) => [key || 'time', label || 'Delay time', 0, ms, Math.min(ms, 350), 'ms'];
    const REV = (maxT) => [['time', 'Reverb time', 0.1, maxT, Math.min(maxT, 2.5), 's'], HD, ['pd', 'Pre delay', 0, 200, 30, 'ms'], ['pdt', 'Pre delay thru', 0, 100, 0, '%'], TR, LO, HI];
    const ROOMX = [['er', 'ER level', 0, 100, 60, ''], ['rev', 'Reverb level', 0, 100, 80, '']];
    const MREV = (maxT) => [['time', 'Reverb time', 0.1, maxT, Math.min(maxT, 2.5), 's'], HD, ['pd', 'Pre delay', 0, 200, 30, 'ms'], ['pdt', 'Pre delay thru', 0, 30, 0, ''], ['trim', 'EQ trim', 0, 30, 30, ''], LO, HI, OUT, ['spread', 'Spread', 0, 30, 20, ''],
      ['er1', 'ER1 delay', 0, 200, 10, 'ms'], ['er2', 'ER2 delay', 0, 200, 20, 'ms'], ['er3', 'ER3 delay', 0, 200, 30, 'ms'], ['er4', 'ER4 delay', 0, 200, 40, 'ms'],
      ['er1l', 'ER1 level', 0, 30, 15, ''], ['er2l', 'ER2 level', 0, 30, 12, ''], ['er3l', 'ER3 level', 0, 30, 10, ''], ['er4l', 'ER4 level', 0, 30, 8, ''],
      ['er1p', 'ER1 pan', 0, 6, 0, ''], ['er2p', 'ER2 pan', 0, 6, 6, ''], ['er3p', 'ER3 pan', 0, 6, 2, ''], ['er4p', 'ER4 pan', 0, 6, 4, '']];
    const MREV_SPEC = (tmax) => 'trim@0:7-3@00@1E@0@30 pdt@0:2-0,1:7-6@00@1E@0@30 pd@1:5-0,2:7-6@00@C8@0@200 hd@2:5-0,3:7@00@64@0@100 time@3:6-0@01@' + tmax.toString(16) + '@0.1@' + (tmax / 10) +
      ' er2@5:7-1@00@7D@0@200 er1@5:0,6:7-2@00@7D@0@200 hi@6:1-0,7:7-5@F1@0F@-15@15 lo@7:4-0@F1@0F@-15@15 out@8:1-0,9:7-3@00@64@0@100 spread@9:2-0,10:7-6@00@1E@0@30 er4@10:5-0,11:7@00@7D@0@200 er3@11:6-0@00@7D@0@200' +
      ' er1p@12:7-5@00@06@0@6 er1l@12:4-0@00@1E@0@30 er2p@13:7-5@00@06@0@6 er2l@13:4-0@00@1E@0@30 er3p@14:7-5@00@06@0@6 er3l@14:4-0@00@1E@0@30 er4p@15:7-5@00@06@0@6 er4l@15:4-0@00@1E@0@30';
    const REV_SPEC = 'time@0@01@64@0.1@10 hd@1@00@64@0@100 pd@2@00@C8@0@200 pdt@3@00@64@0@100 trim@4@00@64@0@100 lo@5@F1@0F@-15@15 hi@6@F1@0F@-15@15 wet@7@00@64@0@100';
    const ROOM_SPEC = 'time@0@01@1E@0.1@3 hd@1@00@64@0@100 pd@2@00@C8@0@200 pdt@3@00@64@0@100 er@4@00@64@0@100 rev@5@00@64@0@100 trim@6@00@64@0@100 lo@7@F1@0F@-15@15 hi@8@F1@0F@-15@15 wet@9@00@64@0@100';
    const DLY = (ms) => [T(ms, 'time'), FB, HD, LD, W];
    const EQ7 = [['type', 'Band type', 0, 11, 0, ''], ['trim', 'Trim', 0, 100, 100, ''], ['b1', 'Band 1', -18, 18, 0, 'dB'], ['b2', 'Band 2', -18, 18, 0, 'dB'], ['b3', 'Band 3', -18, 18, 0, 'dB'], ['b4', 'Band 4', -18, 18, 0, 'dB'], ['b5', 'Band 5', -18, 18, 0, 'dB'], ['b6', 'Band 6', -18, 18, 0, 'dB'], ['b7', 'Band 7', -18, 18, 0, 'dB'], W];
    const EQ7_SPEC = 'type@0@00@0B@0@11 trim@1@00@64@0@100 b1@2@DC@24@-18@18 b2@3@DC@24@-18@18 b3@4@DC@24@-18@18 b4@5@DC@24@-18@18 b5@6@DC@24@-18@18 b6@7@DC@24@-18@18 b7@8@DC@24@-18@18 wet@9@00@64@0@100';
    const EQ13 = [['trim', 'Trim', 0, 100, 100, '']].concat(Array.from({ length: 13 }, (_, i) => ['b' + (i + 1), 'Band ' + (i + 1), -18, 18, 0, 'dB'])).concat([W]);
    const EQ13_SPEC = 'trim@0:7-1@00@64@0@100 b1@0:0,1:7-2@DC@24@-18@18 b2@1:1-0,2:7-3@DC@24@-18@18 b3@2:2-0,3:7-4@DC@24@-18@18 b4@3:3-0,4:7-5@DC@24@-18@18 b5@4:4-0,5:7-6@DC@24@-18@18 b6@5:5-0,6:7@DC@24@-18@18 b7@6:6-0@DC@24@-18@18 b8@7:7-1@DC@24@-18@18 b9@8@DC@24@-18@18 b10@9@DC@24@-18@18 b11@10@DC@24@-18@18 b12@11@DC@24@-18@18 b13@12@DC@24@-18@18 wet@13@00@64@0@100';
    const PEQ = [['trim', 'Trim', 0, 100, 100, ''], ['f1', 'Band 1 freq', 20, 1000, 100, 'Hz', 1], ['q1', 'Band 1 Q', 0.5, 10, 1, ''], ['g1', 'Band 1 gain', -18, 18, 0, 'dB'], ['f2', 'Band 2 freq', 50, 10000, 500, 'Hz', 1], ['q2', 'Band 2 Q', 0.5, 10, 1, ''], ['g2', 'Band 2 gain', -18, 18, 0, 'dB'],
      ['f3', 'Band 3 freq', 300, 10000, 2000, 'Hz', 1], ['q3', 'Band 3 Q', 0.5, 10, 1, ''], ['g3', 'Band 3 gain', -18, 18, 0, 'dB'], ['f4', 'Band 4 freq', 500, 20000, 6000, 'Hz', 1], ['q4', 'Band 4 Q', 0.5, 10, 1, ''], ['g4', 'Band 4 gain', -18, 18, 0, 'dB'],
      ['t1', 'Band 1 type', 'sel', ['Peaking', 'Low shelf'], 1], ['t4', 'Band 4 type', 'sel', ['Peaking', 'High shelf'], 1], W];
    const PEQ_SPEC = 'trim@0@00@64@0@100 t4@1:7@00@01@0@1 f1@1:6-1@00@31@20@1000@log t1@1:0@00@01@0@1 q1@2@00@5F@0.5@10 g1@3@DC@24@-18@18 f2@4@00@C7@50@10000@log q2@5@00@5F@0.5@10 g2@6@DC@24@-18@18 f3@9@00@61@300@10000@log q3@10@00@5F@0.5@10 g3@11@DC@24@-18@18 f4@12@00@C3@500@20000@log q4@13@00@5F@0.5@10 g4@14@DC@24@-18@18 wet@15@00@64@0@100';
    const COMP = [['sens', 'Sensitivity', 1, 100, 50, ''], ['atk', 'Attack', 1, 100, 20, ''], LO, HI, ['outl', 'Output level', 0, 100, 60, ''], W, TR];
    const COMP_SPEC = 'sens@0@01@64@1@100 atk@1@01@64@1@100 lo@2@E2@1E@-15@15 hi@3@E2@1E@-15@15 outl@4@00@64@0@100 wet@5@00@64@0@100 trim@15@00@64@0@100';
    const LIM = [['ratio', 'Ratio (1.0:1 ... 50:1, Inf)', 0, 131, 30, ''], ['thr', 'Threshold', -40, 0, -12, 'dB'], ['atk', 'Attack', 1, 100, 10, ''], ['rel', 'Release', 1, 100, 40, ''], ['gain', 'Gain adjust', -16, 24, 0, 'dB'], W];
    const LIM_SPEC = 'ratio@0@00@83@0@131 thr@1@D8@00@-40@0 atk@2@01@64@1@100 rel@3@01@64@1@100 gain@4@F0@18@-16@24 wet@8@00@64@0@100';
    const MBL = LIM.slice(0, 5).concat([['lowo', 'Low offset', -40, 0, 0, 'dB'], ['mido', 'Mid offset', -40, 0, 0, 'dB'], ['higho', 'High offset', -40, 0, 0, 'dB'], W]);
    const MBL_SPEC = LIM_SPEC.replace(' wet@8@00@64@0@100', '') + ' lowo@5@D8@00@-40@0 mido@6@D8@00@-40@0 higho@7@D8@00@-40@0 wet@8@00@64@0@100';
    const GATE = [['thr', 'Threshold', 0, 100, 30, ''], ['atk', 'Attack', 1, 100, 5, ''], ['rel', 'Release', 1, 100, 30, ''], W];
    const AMP = [['amp', 'Amplifier type', 'sel', ['SS', '6L6', 'EL84'], 0], W];
    const OD = [['mode', 'Mode', 'sel', ['Overdrive', 'Hi-Gain'], 0], ['drive', 'Drive', 0, 100, 40, ''], ['direct', 'Direct mix', 0, 50, 0, ''], ['outl', 'Output level', 0, 50, 25, ''], ['lcut', 'Pre low-cut', 0, 10, 2, ''], W];
    const OD_SPEC = 'drive@0:7-1@00@64@0@100 mode@0:0@00@01@0@1 direct@1@00@32@0@50 outl@2@00@32@0@50 wet@3@00@64@0@100 lcut@6@00@0A@0@10';
    const ODW = [['mode', 'Drive mode', 'sel', ['Overdrive', 'Hi-Gain'], 0], ['drive', 'Drive', 1, 100, 40, ''], ['spk', 'Speaker simulation', 'sel', ['Off', 'On'], 1], ['wah', 'Wah', 'sel', ['Off', 'On'], 0], ['direct', 'Direct mix', 0, 50, 0, ''], ['outl', 'Output level', 0, 50, 25, ''], W, ['wahSrc', 'Wah control', 'src', null, 8]];
    const ODW_SPEC = 'drive@0:7-1@01@64@1@100 mode@0:0@00@01@0@1 spk@1:7@00@01@0@1 wah@1:6@00@01@0@1 direct@1:5-0@00@32@0@50 wahSrc@2:7-3@00@19@0@25 wet@3:5-0,4:7@00@64@0@100 outl@4:6-1@00@32@0@50';
    const CH = [LW, LF, ['pd', 'Pre delay', 0, 50, 8, 'ms'], DP, WS, TR, LO, HI];
    const CH_SPEC = 'wave@0@00@01@0@1 lfoF@1@01@E6@0.02@20@lfo pd@2@00@8C@0@50@dms depth@3@00@64@0@100 wet@4@9C@64@-100@100 trim@8@00@64@0@100 lo@9@E2@1E@-15@15 hi@10@E2@1E@-15@15';
    const ENS = [['speed', 'Speed', 1, 100, 40, ''], DP, W, ['shimmer', 'Shimmer', 0, 100, 30, '']];
    const ENS_SPEC = 'speed@0@01@64@1@100 depth@1@00@64@0@100 wet@2@00@64@0@100 shimmer@15@00@64@0@100';
    const FL = [['delay', 'Delay time', 0, 50, 3, 'ms'], LW, SH, LF, DP, FB, HD, WS];
    const FL_SPEC = 'delay@0@00@8C@0@50@dms wave@1:1@00@01@0@1 shape@2@9C@64@-100@100 lfoF@3@01@E6@0.02@20@lfo depth@5@00@64@0@100 fb@6@9C@64@-100@100 hd@7@00@64@0@100 wet@8@9C@64@-100@100';
    const PHS = [LW, SH, LF, ['manual', 'Manual', 0, 100, 50, ''], DP, ['reso', 'Resonance', -100, 100, 30, ''], HD, WS];
    const PHS_SPEC = 'wave@0:1-0@00@01@0@1 shape@1@9C@64@-100@100 lfoF@2@01@E6@0.02@20@lfo manual@4@00@64@0@100 depth@5@00@64@0@100 reso@6@9C@64@-100@100 hd@7@00@64@0@100 wet@8@9C@64@-100@100';
    const VIB = [LW, SH, LF, DP, W];
    const VIB_SPEC = 'wave@0@00@01@0@1 shape@1@9C@64@-100@100 lfoF@2@01@E6@0.02@20@lfo depth@3@00@64@0@100 wet@4@00@64@0@100';
    const TREM_W = ['wave', 'LFO waveform', 'sel', ['Triangle', 'Sine', 'Square', 'Up', 'Down'], 1];
    const ROT = [['fast', 'Speed', 'sel', ['Slow', 'Fast'], 0], ['acc', 'Acceleration', 0, 100, 50, ''], ['balance', 'Rotor/horn balance', 0, 100, 50, ''], ['mic', 'Mic distance', 0, 100, 40, ''], W, ['spdSrc', 'Speed switch control', 'src', null, 0]];
    const DUAL = [T(680, 'timeL', 'L delay time'), T(680, 'timeR', 'R delay time'), ['fbL', 'L feedback', -100, 100, 30, ''], ['fbR', 'R feedback', -100, 100, 30, ''], ['hdL', 'L high damp', 0, 100, 20, '%'], ['hdR', 'R high damp', 0, 100, 20, '%'], ['ldL', 'L low damp', 0, 100, 0, '%'], ['ldR', 'R low damp', 0, 100, 0, '%'], ['wetL', 'L wet/dry', 0, 100, 50, '%'], ['wetR', 'R wet/dry', 0, 100, 50, '%']];
    const DUAL_SPEC = (tmaxHex, tmax) => 'fbL@0@9C@64@-100@100 fbR@1@9C@64@-100@100 ldL@6:7-1@00@64@0@100 hdR@6:0,7:7-2@00@64@0@100 wetR@7:1-0,8:7-3@00@64@0@100 wetL@8:2-0,9:7-4@00@64@0@100 hdL@9:3-0,10:7-5@00@64@0@100 ldR@10:4-0,11:7-6@00@64@0@100 timeL@12:3-0,13,14:7-6@00@' + tmaxHex + '@0@' + tmax + ' timeR@14:5-0,15@00@' + tmaxHex + '@0@' + tmax;
    const STD = (ms) => [T(ms, 'timeL', 'L delay time'), T(ms, 'timeR', 'R delay time'), FB, HD, LD, W, SP, ['cross', 'Stereo/cross', 'sel', ['Stereo', 'Cross'], 0]];
    const STD_SPEC = (tmaxHex, tmax) => 'fb@0@9C@64@-100@100 hd@1@00@64@0@100 ld@2@00@64@0@100 wet@3@00@64@0@100 spread@4@9C@64@-100@100 cross@9:7@00@01@0@1 timeR@12,13@00@' + tmaxHex + '@0@' + tmax + ' timeL@14,15@00@' + tmaxHex + '@0@' + tmax;
    const LCR = (ms) => [T(ms, 'timeL', 'L delay time'), T(ms, 'timeC', 'C delay time'), T(ms, 'timeR', 'R delay time'), ['lvlL', 'L level', 0, 50, 35, ''], ['lvlC', 'C level', 0, 50, 50, ''], ['lvlR', 'R level', 0, 50, 35, ''], FB, HD, LD, ['spread', 'Spread', 0, 50, 50, ''], W];
    const LCR_SPEC = (tmaxHex, tmax) => 'fb@0@9C@64@-100@100 wet@4:7-1@00@64@0@100 hd@4:0,5:7-2@00@64@0@100 ld@5:1-0,6:7-3@00@64@0@100 spread@6:2-0,7:7-5@00@32@0@50 lvlL@9:5-0@00@32@0@50 lvlC@10:7-2@00@32@0@50 lvlR@10:1-0,11:7-4@00@32@0@50 timeL@11:3-0,12@00@' + tmaxHex + '@0@' + tmax + ' timeC@13,14:7-4@00@' + tmaxHex + '@0@' + tmax + ' timeR@14:3-0,15@00@' + tmaxHex + '@0@' + tmax;
    const TDLY = [FB, ['count', 'Count', 0, 96, 0, 'times'], LD, W, HD].concat(TEMPO.slice(0, 1), [['len', 'Length', 1, 96, 3, ''], ['lenDiv', 'Length /', 1, 96, 16, '']]);
    const TDLY_SPEC = 'fb@0@9C@64@-100@100 count@1:6-0@00@60@0@96 ld@2:6-0@00@64@0@100 wet@3:6-0@00@64@0@100 hd@7:7-1@00@64@0@100 len@13@01@60@1@96 lenDiv@14@01@60@1@96 tempo@15@1E@FA@30@250';
    const ER = (ms) => [['type', 'Type', 'sel', ['Sharp', 'Loose', 'Modulated', 'Reverse'], 0], ['ertime', 'ER time', 10, ms, Math.min(ms, 300), 'ms'], ['pd', 'Pre delay', 0, 200, 10, 'ms'], TR, LO, HI, W];
    const ER_SPEC = (rmax, ms) => 'type@0@00@03@0@3 ertime@1@0A@' + rmax + '@10@' + ms + ' pd@2@00@C8@0@200 trim@3@00@64@0@100 lo@4@E2@1E@-15@15 hi@5@E2@1E@-15@15 wet@6@00@64@0@100';
    const MTC = [['fb', 'Tap 1 feedback', -100, 100, 20, ''], LF, W, ['t1', 'Tap 1 time', 0, 570, 20, 'ms'], ['t2', 'Tap 2 time', 0, 570, 180, 'ms'], ['t3', 'Tap 3 time', 0, 570, 90, 'ms'], ['t4', 'Tap 4 time', 0, 570, 270, 'ms'],
      ['d1', 'Tap 1 depth', 0, 30, 10, ''], ['d2', 'Tap 2 depth', 0, 30, 10, ''], ['d3', 'Tap 3 depth', 0, 30, 10, ''], ['d4', 'Tap 4 depth', 0, 30, 10, ''], ['p1', 'Tap 1 pan', -6, 6, -6, ''], ['p2', 'Tap 2 pan', -6, 6, 6, ''], ['p3', 'Tap 3 pan', -6, 6, -3, ''], ['p4', 'Tap 4 pan', -6, 6, 3, '']];
    const MTC_SPEC = 'fb@0@9C@64@-100@100 p1@3:7-4@FA@06@-6@6 p4@3:3-0@FA@06@-6@6 p2@4:7-4@FA@06@-6@6 p3@4:3-0@FA@06@-6@6 wet@5:5-0,6:7@00@64@0@100 t2@8:2-0,9:7-4@00@7F@0@570 d2@9:3-0,10:7@00@1E@0@30 d3@10:6-2@00@1E@0@30 d1@10:1-0,11:7-5@00@1E@0@30 d4@11:4-0@00@1E@0@30 lfoF@12:2-0,13:7-5@01@3F@0.02@13@log t3@13:4-0,14:7-6@00@7F@0@570 t1@14:5-0,15:7@00@7F@0@570 t4@15:6-0@00@7F@0@570';
    const PITCH = [['shift', 'Pitch shift', -24, 24, 12, 'st'], ['fine', 'Fine', -100, 100, 0, 'ct'], ['mode', 'Mode', 'sel', ['Slow', 'Medium', 'Fast'], 1], ['delay', 'Delay time', 0, 1000, 0, 'ms'], FB, HD, W];
    const RES = [['pitch', 'Pitch', 12, 119, 57, 'note'], ['fine', 'Fine', -50, 50, 0, 'ct'], ['trim', 'Trim', 0, 100, 80, ''], ['reso', 'Resonance', -100, 100, 70, ''], HD, LF, ['lfoDepth', 'LFO depth', -100, 100, 0, ''], W];
    const L = [];
    const add = (grp, name, core, v, params, spec) => L.push({ grp, idx: L.filter(e => e.grp === grp).length, name, core, v, params, spec: spec || '' });
    // ---- size 1 (29) ----
    add('S1', 'Amp Simulation', 'drive', 'amp', AMP, 'amp@0@00@02@0@2 wet@1@00@64@0@100');
    add('S1', 'Compressor', 'dyn', 'comp', COMP, COMP_SPEC);
    add('S1', 'Limiter', 'dyn', 'lim', LIM, LIM_SPEC);
    add('S1', 'Gate', 'dyn', 'gate', GATE, 'thr@0@00@64@0@100 atk@1@01@64@1@100 rel@2@01@64@1@100 wet@7@00@64@0@100');
    add('S1', 'Overdrive/Hi-Gain', 'drive', 'od', OD, OD_SPEC);
    add('S1', 'Parametric 4EQ', 'eq', 'peq', PEQ, PEQ_SPEC);
    add('S1', 'Graphic 7Band EQ', 'eq', 'geq7', EQ7, EQ7_SPEC);
    add('S1', 'Wah/AutoWah', 'filt', 'wah', [['fbot', 'Frequency bottom', 0, 100, 10, ''], ['ftop', 'Frequency top', 0, 100, 90, ''], ['auto', 'Sweep', 'sel', ['Auto (envelope)', 'Controller', 'LFO'], 0], ['sens', 'Envelope sens', 0, 100, 70, ''], ['eshape', 'Envelope shape', -100, 100, 0, ''], ['reso', 'Resonance', 0, 100, 60, ''], W, ['src', 'Sweep control', 'src', null, 8], ['lfoF', 'LFO frequency', 0.02, 20, 1, 'Hz', 1]],
      'fbot@0@00@64@0@100 ftop@1@00@64@0@100 src@2:5-1@00@19@0@25 auto@2:0@00@01@0@1 sens@3@00@64@0@100 eshape@4@9C@64@-100@100 reso@5@00@64@0@100 wet@6@00@64@0@100');
    add('S1', 'Random Filter', 'filt', 'rand', [['lfoF', 'LFO frequency', 0.05, 50, 4, 'Hz', 1], ['cutoff', 'Cutoff', 0, 100, 50, ''], DP, ['reso', 'Resonance', 0, 100, 50, ''], WS], 'lfoF@0@01@C8@0.05@50@log cutoff@3@00@64@0@100 depth@4@00@64@0@100 reso@7@00@64@0@100 wet@8@9C@64@-100@100');
    add('S1', 'Dyna Exciter', 'filt', 'exc', [['blend', 'Blend', -100, 100, 40, ''], ['point', 'Emphatic point', 0, 140, 70, ''], TR, LO, HI, W], 'blend@0@9C@64@-100@100 point@3@00@8C@0@140 trim@6@00@64@0@100 lo@7@E2@1E@-15@15 hi@8@E2@1E@-15@15 wet@9@00@64@0@100');
    add('S1', 'Sub Oscillator', 'filt', 'sub', [['mode', 'OSC mode', 'sel', ['Note (key follow)', 'Fixed'], 0], ['interval', 'Note interval', -48, 0, -12, 'st'], ['fine', 'Note fine', -100, 100, 0, 'ct'], ['fixed', 'Fixed frequency', 10, 80, 40, 'Hz'], ['sens', 'Envelope sens', 0, 100, 60, ''], W],
      'mode@0@00@01@0@1 interval@1@D0@00@-48@0 fine@3@9C@64@-100@100 fixed@4@20@A0@10@80 sens@8@00@64@0@100 wet@10@00@64@0@100');
    add('S1', 'Decimator', 'drive', 'deci', [['prelpf', 'Pre LPF', 'sel', ['Off', 'On'], 1], ['fs', 'Sampling frequency', 1000, 48000, 12000, 'Hz'], ['res', 'Resolution', 4, 24, 24, 'bit'], HD, W], 'prelpf@0@00@01@0@1 fs@1@0A@F0@1000@24000 hd@4@00@64@0@100 wet@5@00@64@0@100');
    add('S1', 'Chorus', 'mod', 'chorus', CH, CH_SPEC);
    add('S1', 'Harmonic Chorus', 'mod', 'hchorus', [['split', 'High/low split', 1, 100, 40, ''], LF, ['pd', 'Pre delay', 0, 50, 10, 'ms'], DP, FB, HD, ['lowl', 'Low level', 0, 100, 100, ''], ['highl', 'High level', 0, 100, 100, ''], W],
      'split@0@01@64@1@100 lfoF@2@01@E6@0.02@20@lfo pd@3@00@8C@0@50@dms depth@4@00@64@0@100 fb@5@9C@64@-100@100 hd@6@00@64@0@100 lowl@7@00@64@0@100 highl@8@00@64@0@100 wet@9@00@64@0@100');
    add('S1', 'Ensemble', 'mod', 'ens', ENS, ENS_SPEC);
    add('S1', 'Flanger', 'mod', 'flanger', FL, FL_SPEC);
    add('S1', 'Tempo Flanger', 'mod', 'tflanger', [['delay', 'Delay time', 0, 50, 3, 'ms'], LW, SH].concat(TEMPO, [DP, FB, HD, WS]), 'delay@0@00@8C@0@50@dms wave@1@00@01@0@1 shape@2@9C@64@-100@100 tempo@5@1E@FA@30@250 len@6@01@10@1@16 lenDiv@7@01@10@1@16 depth@8@00@64@0@100 fb@9@9C@64@-100@100 hd@10@00@64@0@100 wet@11@9C@64@-100@100');
    add('S1', 'Envelope Flanger', 'mod', 'eflanger', [['dbot', 'Delay bottom', 0, 50, 1, 'ms'], ['dtop', 'Delay top', 0, 50, 8, 'ms'], ['decay', 'EG decay', 1, 100, 40, ''], FB, HD, WS], 'dbot@0@00@8C@0@50@dms dtop@1@00@8C@0@50@dms decay@4@01@64@1@100 fb@5@9C@64@-100@100 hd@6@00@64@0@100 wet@7@9C@64@-100@100');
    add('S1', 'Phaser', 'phaser', 'ph', PHS, PHS_SPEC);
    add('S1', 'Tempo Phaser', 'phaser', 'tph', [LW, SH].concat(TEMPO, [['manual', 'Manual', 0, 100, 50, ''], DP, ['reso', 'Resonance', -100, 100, 30, ''], HD, WS]), 'wave@0@00@01@0@1 shape@1@9C@64@-100@100 tempo@4@1E@FA@30@250 len@5@01@10@1@16 lenDiv@6@01@10@1@16 manual@7@00@64@0@100 depth@8@00@64@0@100 reso@9@9C@64@-100@100 hd@10@00@64@0@100 wet@11@9C@64@-100@100');
    add('S1', 'Envelope Phaser', 'phaser', 'eph', [['mbot', 'Manual bottom', 0, 100, 10, ''], ['mtop', 'Manual top', 0, 100, 90, ''], ['decay', 'EG decay', 1, 100, 40, ''], ['reso', 'Resonance', -100, 100, 30, ''], HD, WS], 'mbot@0@00@64@0@100 mtop@1@00@64@0@100 decay@4@01@64@1@100 reso@5@9C@64@-100@100 hd@6@00@64@0@100 wet@7@9C@64@-100@100');
    add('S1', 'Vibrato', 'mod', 'vib', VIB, VIB_SPEC);
    add('S1', 'Resonator', 'filt', 'reson', RES, 'fine@0@FB@05@-50@50 trim@1@00@64@0@100 reso@2@9C@64@-100@100 lfoF@3@01@E6@0.02@20@lfo wet@4@00@64@0@100 lfoDepth@6@9C@64@-100@100 pitch@7@00@6B@12@119 hd@8@00@64@0@100');
    add('S1', 'Ring Modulator', 'filt', 'ring', [['mode', 'OSC mode', 'sel', ['Fixed', 'Note (key follow)'], 0], ['fixed', 'Fixed frequency', 0, 12000, 400, 'Hz'], ['noteOfs', 'Note offset', -48, 48, 0, 'st'], ['fine', 'Note fine', -100, 100, 0, 'ct'], LF, ['lfoDepth', 'LFO depth', 0, 100, 0, ''], W],
      'mode@0:7@00@01@0@1 fixed@1@00@E4@0@12000 noteOfs@4@D0@30@-48@48 fine@6@9C@64@-100@100 lfoF@7@01@E6@0.02@20@lfo lfoDepth@10@00@64@0@100 wet@13@00@64@0@100');
    add('S1', 'Tremolo', 'trem', 'trem', [TREM_W, SH, LF, DP, W], 'wave@0@00@04@0@4 shape@1@9C@64@-100@100 lfoF@2@01@E6@0.02@20@lfo depth@5@00@64@0@100 wet@8@00@64@0@100');
    add('S1', 'Rotary Speaker', 'rot', 'rot', ROT, 'fast@0@00@01@0@1 acc@1@00@64@0@100 balance@3@00@64@0@100 wet@4@00@64@0@100 spdSrc@5@00@19@0@25 mic@10@00@64@0@100');
    add('S1', 'Delay', 'delay', 'mono', DLY(680), 'fb@0@9C@64@-100@100 hd@1@00@64@0@100 ld@2@00@64@0@100 wet@3@00@64@0@100 time@14,15@00@1A90@0@680');
    add('S1', 'Multitap Delay', 'delay', 'mtap', [T(680, 't1', 'Tap 1 time'), T(680, 't2', 'Tap 2 time'), ['lvl1', 'Tap 1 level', 0, 100, 60, ''], FB, HD, LD, W], 'fb@0@9C@64@-100@100 hd@1@00@64@0@100 ld@2@00@64@0@100 wet@3@00@64@0@100 lvl1@8@00@64@0@100 t2@12,13@00@1A90@0@680 t1@14,15@00@1A90@0@680');
    add('S1', 'Early Reflections', 'reverb', 'er', ER(400), ER_SPEC('82', 400));
    // ---- size 2 (52) ----
    add('S2', 'St. Amp Simulation', 'drive', 'amp', AMP, 'amp@0@00@02@0@2 wet@1@00@64@0@100');
    add('S2', 'Stereo Compressor', 'dyn', 'comp', COMP, COMP_SPEC);
    add('S2', 'Stereo Limiter', 'dyn', 'lim', LIM, LIM_SPEC);
    add('S2', 'Multiband Limiter', 'dyn', 'mbl', MBL, MBL_SPEC);
    add('S2', 'Stereo Gate', 'dyn', 'gate', GATE, 'thr@0@00@64@0@100 atk@1@01@64@1@100 rel@2@01@64@1@100 wet@7@00@64@0@100');
    add('S2', 'OD/Hi-Gain Wah', 'drive', 'odw', ODW, ODW_SPEC);
    add('S2', 'St. Parametric 4EQ', 'eq', 'peq', PEQ, PEQ_SPEC);
    add('S2', 'St. Graphic 7EQ', 'eq', 'geq7', EQ7, EQ7_SPEC);
    add('S2', 'Graphic 13Band EQ', 'eq', 'geq13', EQ13, EQ13_SPEC);
    add('S2', 'St. Random Filter', 'filt', 'rand', [['lfoF', 'LFO frequency', 0.05, 50, 4, 'Hz', 1], ['cutoff', 'Cutoff', 0, 100, 50, ''], DP, ['reso', 'Resonance', 0, 100, 50, ''], SP, WS], 'lfoF@2@01@C6@0.05@50@log cutoff@5@00@64@0@100 depth@6@00@64@0@100 reso@9@00@64@0@100 spread@10@9C@64@-100@100 wet@11@9C@64@-100@100');
    add('S2', 'Stereo Enhancer', 'filt', 'enh', [['blend', 'Exciter blend', -100, 100, 40, ''], ['point', 'Emphatic point', 0, 140, 70, ''], ['dlyL', 'Enhancer delay L', 0, 50, 5, 'ms'], ['dlyR', 'Enhancer delay R', 0, 50, 12, 'ms'], ['width', 'Enhancer width', 0, 100, 50, ''], ['amb', 'Ambience', 0, 100, 20, ''], TR, LO, HI, W],
      'blend@0@9C@64@-100@100 point@2@00@8C@0@140 dlyL@4@00@8C@0@50@dms dlyR@5@00@8C@0@50@dms trim@8:6-0@00@64@0@100 amb@9:7-1@00@64@0@100 width@9:0,10:7-2@00@64@0@100 wet@12:1-0,13:7-3@00@64@0@100 hi@13:2-0,14:7-4@E2@1E@-15@15 lo@14:3-0,15:7-5@E2@1E@-15@15');
    add('S2', 'Talking Modulator', 'filt', 'talk', [['manual', 'Voice control', 0, 100, 50, ''], ['src', 'Voice control source', 'src', null, 8], ['top', 'Voice top', 'sel', ['A', 'I', 'U', 'E', 'O'], 1], ['center', 'Voice center', 'sel', ['A', 'I', 'U', 'E', 'O'], 0], ['bottom', 'Voice bottom', 'sel', ['A', 'I', 'U', 'E', 'O'], 2], ['shift', 'Formant shift', -100, 100, 0, ''], ['reso', 'Resonance', 0, 100, 60, ''], W, ['sweep', 'Voice control by', 'sel', ['Manual / source', 'LFO'], 0], ['lfoF', 'LFO frequency', 0.02, 20, 0.5, 'Hz', 1]],
      'manual@0@00@64@0@100 src@1@00@19@0@25 top@2@00@04@0@4 center@3@00@04@0@4 bottom@4@00@04@0@4 shift@5@9C@64@-100@100 reso@6@00@64@0@100 wet@7@00@64@0@100');
    add('S2', 'Stereo Decimator', 'drive', 'deci', [['prelpf', 'Pre LPF', 'sel', ['Off', 'On'], 1], ['fs', 'Sampling frequency', 1000, 48000, 12000, 'Hz'], ['res', 'Resolution', 4, 24, 24, 'bit'], HD, W], 'prelpf@0@00@01@0@1 fs@1@0A@F0@1000@24000 hd@4@00@64@0@100 wet@5@00@64@0@100');
    add('S2', 'Stereo Chorus', 'mod', 'stchorus', [LF, PH, ['pdL', 'L pre delay', 0, 50, 8, 'ms'], ['pdR', 'R pre delay', 0, 50, 12, 'ms'], LW, DP, SP, WS, TR, LO, HI],
      'lfoF@0@01@E6@0.02@20@lfo phase@1@EE@12@-180@180 pdL@2@00@8C@0@50@dms pdR@3@00@8C@0@50@dms wave@4:7@00@01@0@1 depth@4:6-0@00@64@0@100 spread@5@9C@64@-100@100 wet@6@9C@64@-100@100 trim@10@00@64@0@100 hi@11:6-1@E2@1E@-15@15 lo@11:0,12:7-3@E2@1E@-15@15');
    add('S2', 'St. HarmonicChorus', 'mod', 'hchorus', [['split', 'High/low split', 1, 100, 40, ''], PH, LF, ['pd', 'Pre delay', 0, 50, 10, 'ms'], LW, DP, FB, HD, ['lowl', 'Low level', 0, 100, 100, ''], ['highl', 'High level', 0, 100, 100, ''], W],
      'split@0@01@64@1@100 phase@1@EE@12@-180@180 lfoF@2@01@E6@0.02@20@lfo pd@3@00@8C@0@50@dms wave@4:7@00@01@0@1 depth@4:6-0@00@64@0@100 fb@5@9C@64@-100@100 hd@6@00@64@0@100 lowl@7@00@64@0@100 highl@8@00@64@0@100 wet@9@00@64@0@100');
    add('S2', 'Multitap Chorus/Dly', 'mod', 'mtc', MTC, MTC_SPEC);
    add('S2', 'Ensemble', 'mod', 'ens', ENS, ENS_SPEC);
    add('S2', 'Stereo Flanger', 'mod', 'flanger', [['delay', 'Delay time', 0, 50, 3, 'ms'], LW, SH, PH, LF, DP, FB, HD, SP, WS],
      'wave@0:5@00@01@0@1 delay@2@00@8C@0@50@dms shape@3@9C@64@-100@100 phase@4@EE@12@-180@180 lfoF@5@01@E6@0.02@20@lfo depth@8@00@64@0@100 fb@9@9C@64@-100@100 hd@10@00@64@0@100 spread@11@9C@64@-100@100 wet@12@9C@64@-100@100');
    add('S2', 'St. Random Flanger', 'mod', 'rflanger', [['delay', 'Delay time', 0, 50, 3, 'ms'], PH, LF, ['stepF', 'LFO step frequency', 0.05, 50, 4, 'Hz', 1], DP, FB, HD, SP, WS],
      'delay@0@00@8C@0@50@dms phase@2@EE@12@-180@180 lfoF@3@01@E6@0.02@20@lfo stepF@4@01@C8@0.05@50@log depth@5@00@64@0@100 fb@6@9C@64@-100@100 hd@7@00@64@0@100 spread@8@9C@64@-100@100 wet@9@9C@64@-100@100');
    add('S2', 'St. Tempo Flanger', 'mod', 'tflanger', [['delay', 'Delay time', 0, 50, 3, 'ms'], SH, PH].concat(TEMPO, [DP, FB, HD, SP, WS]),
      'delay@1@00@8C@0@50@dms shape@2@9C@64@-100@100 phase@3@EE@12@-180@180 tempo@5@1E@FA@30@250 len@6@01@10@1@16 lenDiv@7@01@10@1@16 depth@8@00@64@0@100 fb@9@9C@64@-100@100 hd@10@00@64@0@100 spread@11@9C@64@-100@100 wet@12@9C@64@-100@100');
    add('S2', 'Stereo Phaser', 'phaser', 'ph', [LW, SH, PH, LF, ['manual', 'Manual', 0, 100, 50, ''], DP, ['reso', 'Resonance', -100, 100, 30, ''], HD, SP, WS],
      'wave@0:1@00@01@0@1 shape@1@9C@64@-100@100 phase@2@EE@12@-180@180 lfoF@3@01@E6@0.02@20@lfo manual@5@00@64@0@100 depth@6@00@64@0@100 reso@7@9C@64@-100@100 hd@8@00@64@0@100 spread@9@9C@64@-100@100 wet@10@9C@64@-100@100');
    add('S2', 'St. Random Phaser', 'phaser', 'rph', [PH, LF, ['stepF', 'LFO step frequency', 0.05, 50, 4, 'Hz', 1], ['manual', 'Manual', 0, 100, 50, ''], DP, ['reso', 'Resonance', -100, 100, 30, ''], HD, SP, WS],
      'phase@1@EE@12@-180@180 lfoF@2@01@E6@0.02@20@lfo stepF@5@01@C8@0.05@50@log manual@7@00@64@0@100 depth@8@00@64@0@100 reso@9@9C@64@-100@100 hd@10@00@64@0@100 spread@11@9C@64@-100@100 wet@12@9C@64@-100@100');
    add('S2', 'St. Tempo Phaser', 'phaser', 'tph', [SH, PH].concat(TEMPO, [['manual', 'Manual', 0, 100, 50, ''], DP, ['reso', 'Resonance', -100, 100, 30, ''], HD, SP, WS]),
      'shape@1@9C@64@-100@100 phase@2@EE@12@-180@180 tempo@4@1E@FA@30@250 len@5@01@10@1@16 lenDiv@6@01@10@1@16 manual@7@00@64@0@100 depth@8@00@64@0@100 reso@9@9C@64@-100@100 hd@10@00@64@0@100 spread@11@9C@64@-100@100 wet@12@9C@64@-100@100');
    add('S2', 'St. Bi-phase Mod.', 'mod', 'biph', [['lfoF', 'LFO 1 frequency', 0.02, 30, 0.4, 'Hz', 1], ['lfoF2', 'LFO 2 frequency', 0.02, 30, 0.7, 'Hz', 1], ['pdL', 'L pre delay', 0, 50, 5, 'ms'], ['pdR', 'R pre delay', 0, 50, 8, 'ms'], ['depth', 'Depth 1', 0, 100, 40, ''], ['depth2', 'Depth 2', 0, 100, 30, ''], FB, HD, WS],
      'lfoF@0@01@FA@0.02@30@log lfoF2@1@01@FA@0.02@30@log pdL@2@00@8C@0@50@dms depth@3:6-0@00@64@0@100 depth2@4:6-0@00@64@0@100 fb@5@9C@64@-100@100 hd@6:6-0@00@64@0@100 wet@7@9C@64@-100@100 pdR@13@00@8C@0@50@dms');
    add('S2', 'Stereo Vibrato', 'mod', 'vib', VIB, VIB_SPEC);
    add('S2', '2-Voice Resonator', 'filt', 'reson2', [['pitch', 'Voice 1 pitch', 12, 119, 57, 'note'], ['pitch2', 'Voice 2 pitch', 12, 119, 64, 'note'], ['fine', 'Voice 1 fine', -50, 50, 0, 'ct'], ['fine2', 'Voice 2 fine', -50, 50, 0, 'ct'], ['reso', 'Voice 1 resonance', -100, 100, 70, ''], ['reso2', 'Voice 2 resonance', -100, 100, 70, ''],
      ['lvl1', 'Voice 1 level', 0, 100, 80, ''], ['lvl2', 'Voice 2 level', 0, 100, 80, ''], ['pan1', 'Voice 1 pan', -6, 6, -3, ''], ['pan2', 'Voice 2 pan', -6, 6, 3, ''], ['hd', 'Voice 1 high damp', 0, 100, 20, '%'], ['hd2', 'Voice 2 high damp', 0, 100, 20, '%'], ['trim', 'Trim', 0, 100, 80, ''], LF, ['lfoDepth', 'Mod depth', -100, 100, 0, ''], W],
      'fine2@0:7-4@FB@05@-50@50 fine@0:3-0@FB@05@-50@50 trim@1:6-0@00@64@0@100 reso@2@9C@64@-100@100 reso2@3@9C@64@-100@100 lfoF@4@01@E6@0.02@20@lfo lfoDepth@6@9C@64@-100@100 pan2@7:7-4@FA@06@-6@6 pan1@7:3-0@FA@06@-6@6 wet@9:4-0,10:7-6@00@64@0@100 lvl2@10:5-0,11:7@00@64@0@100 lvl1@11:6-0@00@64@0@100 hd2@12:3-0,13:7-5@00@64@0@100 hd@13:4-0,14:7-6@00@64@0@100 pitch2@14:5-0,15:7@00@6B@12@119 pitch@15:6-0@00@6B@12@119');
    add('S2', 'Doppler', 'mod', 'doppler', [LF, ['pdepth', 'Pitch depth', 0, 100, 40, ''], ['pandepth', 'Pan depth', -100, 100, 60, ''], W], 'lfoF@2@01@E6@0.02@20@lfo pdepth@5@00@64@0@100 pandepth@8@9C@64@-100@100 wet@11@00@64@0@100');
    add('S2', 'Stereo Tremolo', 'trem', 'trem', [TREM_W, SH, PH, LF, DP, W], 'wave@2@00@04@0@4 shape@3@9C@64@-100@100 phase@4@EE@12@-180@180 lfoF@5@01@E6@0.02@20@lfo depth@8@00@64@0@100 wet@11@00@64@0@100');
    add('S2', 'Stereo Auto Pan', 'trem', 'pan', [LW, SH, ['phase', 'LFO phase', -180, 180, 180, '°'], LF, DP, W], 'wave@0@00@01@0@1 shape@1@9C@64@-100@100 phase@2@EE@12@-180@180 lfoF@3@01@E6@0.02@20@lfo depth@6@00@64@0@100 wet@9@00@64@0@100');
    add('S2', 'St. Envelope Pan', 'trem', 'envpan', [['atk', 'EG attack', 1, 100, 20, ''], ['rel', 'EG release', 1, 100, 40, ''], ['lStart', 'L start', 0, 100, 0, ''], ['lDest', 'L destination', 0, 100, 100, ''], ['rStart', 'R start', 0, 100, 100, ''], ['rDest', 'R destination', 0, 100, 0, ''], W],
      'atk@2@01@64@1@100 rel@3@01@64@1@100 lStart@4@00@64@0@100 lDest@5@00@64@0@100 rStart@6@00@64@0@100 rDest@7@00@64@0@100 wet@8@00@64@0@100');
    add('S2', 'Stereo Dyna Pan', 'trem', 'dynapan', [['rate', 'Panning rate', 1, 100, 40, ''], ['lStart', 'L start', 0, 100, 0, ''], ['lDest', 'L destination', 0, 100, 100, ''], ['rStart', 'R start', 0, 100, 100, ''], ['rDest', 'R destination', 0, 100, 0, ''], W],
      'rate@5@01@64@1@100 lStart@8@00@64@0@100 lDest@9@00@64@0@100 rStart@10@00@64@0@100 rDest@11@00@64@0@100 wet@12@00@64@0@100');
    add('S2', 'Phaser+Tremolo', 'phaser', 'phtrem', [LF, ['manual', 'Phaser manual', 0, 100, 50, ''], ['depth', 'Phaser depth', 0, 100, 50, ''], ['reso', 'Phaser resonance', -100, 100, 30, ''], ['pwet', 'Phaser wet/dry', -100, 100, 50, ''], ['tdepth', 'Tremolo depth', 0, 100, 40, ''], ['tshape', 'Tremolo shape', -100, 100, 0, ''], W],
      'lfoF@0@01@E6@0.02@20@lfo manual@2@00@64@0@100 reso@4@9C@64@-100@100 pwet@5@9C@64@-100@100 tshape@6@9C@64@-100@100 wet@8@00@64@0@100 depth@10:7-1@00@64@0@100 tdepth@12:7-1@00@64@0@100');
    add('S2', 'Shimmer', 'mod', 'shimmer', [['sens', 'Envelope sens', 0, 100, 60, ''], TREM_W, SH, PH, LF, DP, W], 'sens@0@00@64@0@100 wave@2@00@04@0@4 shape@3@9C@64@-100@100 phase@4@EE@12@-180@180 lfoF@5@01@E6@0.02@20@lfo depth@7@00@64@0@100 wet@9@00@64@0@100');
    add('S2', 'Detune', 'pitch', 'detune', [['cents', 'Pitch shift', -100, 100, 8, 'ct'], ['delay', 'Delay time', 0, 1000, 0, 'ms'], HD, W], 'cents@0@9C@64@-100@100 delay@3@00@BE@0@1000 hd@4@00@64@0@100 wet@5@00@64@0@100');
    add('S2', 'Pitch Shifter', 'pitch', 'pitch', PITCH, 'mode@3@00@02@0@2 shift@4@E8@18@-24@24 fine@7@9C@64@-100@100 delay@9@00@BE@0@1000 fb@10@9C@64@-100@100 hd@11@00@64@0@100 wet@12@00@64@0@100');
    add('S2', 'Pitch Shift Mod.', 'pitch', 'psmod', [['cents', 'Pitch shift', -100, 100, 10, 'ct'], ['wave', 'LFO waveform', 'sel', ['Triangle', 'Square'], 0], LF, ['depth', 'Depth', -100, 100, 50, ''], ['pan', 'Pan', 0, 100, 50, ''], W],
      'cents@0@9C@64@-100@100 wave@1@00@01@0@1 lfoF@2@01@E6@0.02@20@lfo depth@5@9C@64@-100@100 pan@8@00@64@0@100 wet@9@00@64@0@100');
    add('S2', 'Rotary Speaker', 'rot', 'rot', ROT, 'fast@0:1@00@01@0@1 acc@3@00@64@0@100 balance@5@00@64@0@100 mic@6:6-0@00@32@0@100 wet@8@00@64@0@100 spdSrc@12@00@19@0@25');
    add('S2', 'Dual Delay', 'delay', 'dual', DUAL, DUAL_SPEC('1A90', 680));
    add('S2', 'Stereo Delay', 'delay', 'stereo', STD(680), STD_SPEC('1A90', 680));
    add('S2', 'St. Multitap Delay', 'delay', 'stmtap', [T(680, 't1', 'Tap 1 time'), T(680, 't2', 'Tap 2 time'), ['lvl1', 'Tap 1 level', 0, 100, 60, ''], FB, HD, LD, W, SP, ['mode', 'Mode', 'sel', ['Normal', 'Cross', 'Pan 1', 'Pan 2'], 0]],
      'fb@0@9C@64@-100@100 mode@1:7-6@00@03@0@3 spread@4@9C@64@-100@100 lvl1@9:7-1@00@64@0@100 wet@9:0,10:7-2@00@64@0@100 ld@10:1-0,11:7-3@00@64@0@100 hd@11:2-0,12:7-4@00@64@0@100 t2@12:3-0,13,14:7-6@00@1A90@0@680 t1@14:5-0,15@00@1A90@0@680');
    add('S2', 'L/C/R Delay', 'delay', 'lcr', LCR(1360), LCR_SPEC('550', 1360));
    add('S2', 'Tempo Delay', 'delay', 'tempo', TDLY, TDLY_SPEC);
    add('S2', 'St. Modulation Delay', 'delay', 'stmod', [T(500, 'timeL', 'L delay time'), T(500, 'timeR', 'R delay time'), ['fbL', 'L feedback', -100, 100, 30, ''], ['fbR', 'R feedback', -100, 100, 30, ''], ['depthL', 'L depth', 0, 200, 30, ''], ['depthR', 'R depth', 0, 200, 30, ''], LW, SH, LF, WS],
      'fbL@0@9C@64@-100@100 fbR@1@9C@64@-100@100 depthL@2@00@C8@0@200 depthR@3@00@C8@0@200 shape@4@9C@64@-100@100 lfoF@5@01@E6@0.02@20@lfo wave@7:7@00@01@0@1 wet@8@9C@64@-100@100 timeR@12:1-0,13,14:7-5@00@1388@0@500 timeL@14:4-0,15@00@1388@0@500');
    add('S2', 'St. Dynamic Delay', 'delay', 'dyn', [T(680, 'timeL', 'L delay time'), T(680, 'timeR', 'R delay time'), ['thr', 'Threshold', 0, 100, 40, ''], ['atk', 'Attack', 1, 100, 10, ''], ['rel', 'Release', 1, 100, 40, ''], FB, HD, LD, SP, W, ['pol', 'Polarity', 'sel', ['+ (duck while playing)', '−'], 0]],
      'thr@0@00@64@0@100 atk@1@01@64@1@100 rel@2@01@64@1@100 fb@3@9C@64@-100@100 hd@4@00@64@0@100 ld@5@00@64@0@100 spread@6@9C@64@-100@100 wet@7@00@64@0@100 pol@11@00@01@0@1 timeL@12,13@00@1A90@0@680 timeR@14,15@00@1A90@0@680');
    add('S2', 'Random Panning Dly', 'delay', 'randpan', [T(680, 'timeL', 'L delay time'), T(680, 'timeR', 'R delay time'), ['fbL', 'L feedback', -100, 100, 30, ''], ['fbR', 'R feedback', -100, 100, 30, ''], ['spdL', 'L panning speed', 0.02, 20, 1, 'Hz', 1], ['spdR', 'R panning speed', 0.02, 20, 1.3, 'Hz', 1], ['pspread', 'Panning spread', 0, 100, 80, ''], ['lvlL', 'L delay level', 0, 100, 80, ''], ['lvlR', 'R delay level', 0, 100, 80, ''], W],
      'fbL@0@9C@64@-100@100 fbR@1@9C@64@-100@100 spdL@2@01@E6@0.02@20@lfo spdR@3@01@E6@0.02@20@lfo pspread@4@00@64@0@100 lvlL@5@00@64@0@100 lvlR@6@00@64@0@100 wet@7@00@64@0@100 timeR@12,13@00@1A90@0@680 timeL@14,15@00@1A90@0@680');
    add('S2', 'Early Reflections', 'reverb', 'er', ER(800), ER_SPEC('AA', 800));
    add('S2', 'Reverb-Hall', 'reverb', 'hall', REV(10).concat([W]), REV_SPEC);
    add('S2', 'Reverb-SmoothHall', 'reverb', 'smooth', REV(10).concat([W]), REV_SPEC);
    add('S2', 'Reverb-Room', 'reverb', 'room', REV(3).concat(ROOMX, [W]), ROOM_SPEC);
    add('S2', 'Reverb-BrightRoom', 'reverb', 'bright', REV(3).concat(ROOMX, [W]), ROOM_SPEC);
    add('S2', 'Reverb-Wet Plate', 'reverb', 'wetplate', REV(10).concat([W]), REV_SPEC);
    add('S2', 'Reverb-Dry Plate', 'reverb', 'dryplate', REV(10).concat([W]), REV_SPEC);
    // ---- size 4 (19) ----
    add('S4', 'Piano Body/Damper', 'filt', 'piano', [['board', 'Sound board depth', 0, 100, 50, ''], ['damper', 'Damper depth', 0, 100, 40, ''], ['tone', 'Tone', 1, 100, 60, ''], W], 'board@0@00@64@0@100 damper@1@00@64@0@100 tone@3@01@64@1@100 wet@5@00@64@0@100');
    add('S4', 'St. Mlt.band Limiter', 'dyn', 'mbl', MBL, MBL_SPEC);
    add('S4', 'OD/Hyper-Gain Wah', 'drive', 'odw', ODW.map(q => q[0] === 'drive' ? ['drive', 'Drive', 1, 120, q[4], q[5]] : q), ODW_SPEC.replace('drive@0:7-1@01@64@1@100', 'drive@0:7-1@01@78@1@120'));
    add('S4', 'St. Graphic 13EQ', 'eq', 'geq13', EQ13, EQ13_SPEC);
    add('S4', 'Vocoder', 'filt', 'voc', [['modTrim', 'Modulator trim', 0, 100, 80, ''], ['carTrim', 'Carrier trim', 0, 100, 80, ''], ['hiMix', 'Modulator high mix', 0, 100, 20, ''], ['vc', 'Vocoder/carrier', 0, 100, 80, ''], W], 'carTrim@0@00@64@0@100 modTrim@1@00@64@0@100 hiMix@2@00@64@0@100 vc@3@00@64@0@100 wet@6@00@64@0@100');
    add('S4', 'St. HarmonicChorus', 'mod', 'hchorus', [['split', 'High/low split', 1, 100, 40, ''], PH, LF, ['pd', 'Pre delay', 0, 50, 10, 'ms'], LW, DP, FB, HD, ['lowl', 'Low level', 0, 100, 100, ''], ['highl', 'High level', 0, 100, 100, ''], W],
      'wave@0:7@00@01@0@1 split@0:6-0@01@64@1@100 lfoF@2@01@E6@0.02@20@lfo pd@5@00@8C@0@50@dms depth@7:5-0,8:7@00@64@0@100 wet@10:6-0@00@64@0@100');
    add('S4', 'Multitap Chorus/Dly', 'mod', 'mtc', MTC, 'fb@0@9C@64@-100@100 lfoF@3:5-0@01@3F@0.02@13@log wet@4:2-0,5:7-4@00@64@0@100 t2@11:6-0@00@7F@0@570 t4@10:5-0,11:7@00@7F@0@570 t3@13:4-0,14:7-6@00@7F@0@570 t1@14:5-0,15:7@00@7F@0@570 d1@9:7-3@00@1E@0@30 d2@6:6-2@00@1E@0@30 d3@7:4-0@00@1E@0@30 d4@5:3-0,6:7@00@1E@0@30');
    add('S4', 'Stereo Ensemble', 'mod', 'stens', ENS.concat([SP, TR, LO, HI]), 'speed@0@01@64@1@100 depth@1@00@64@0@100 wet@2@00@64@0@100 hi@11@E2@1E@-15@15 lo@12@E2@1E@-15@15 spread@13@9C@64@-100@100 trim@14@00@64@0@100 shimmer@15@00@64@0@100');
    add('S4', 'St. Tempo Flanger', 'mod', 'tflanger', [['delay', 'Delay time', 0, 50, 3, 'ms'], SH, PH].concat(TEMPO, [DP, FB, HD, SP, WS]), 'delay@0@00@8C@0@50@dms shape@1@9C@64@-100@100 tempo@2@1E@FA@30@250 fb@3@9C@64@-100@100 spread@4@9C@64@-100@100 wet@5@9C@64@-100@100 depth@10:7-1@00@64@0@100');
    add('S4', 'St. Tempo Phaser', 'phaser', 'tph', [SH, PH].concat(TEMPO, [['manual', 'Manual', 0, 100, 50, ''], DP, ['reso', 'Resonance', -100, 100, 30, ''], HD, SP, WS]), 'shape@0@9C@64@-100@100 tempo@1@1E@FA@30@250 reso@3@9C@64@-100@100 spread@4@9C@64@-100@100 wet@5@9C@64@-100@100 manual@10:7-1@00@64@0@100');
    add('S4', 'St. Pitch Shifter', 'pitch', 'stpitch', PITCH.concat([['updown', 'L/R pitch', 'sel', ['Normal', 'Up/down'], 0], SP]), 'shift@2@E8@18@-24@24 fine@5@9C@64@-100@100 delay@7@00@BE@0@1000 fb@9@9C@64@-100@100 hd@10@00@64@0@100 spread@11@9C@64@-100@100 wet@12@00@64@0@100 updown@15:7@00@01@0@1 mode@15:6-5@00@02@0@2');
    add('S4', '2Band Pitch Shifter', 'pitch', 'pitch2', [['lowShift', 'Low pitch', -24, 24, -12, 'st'], ['shift', 'High pitch', -24, 24, 12, 'st'], ['lowFine', 'Low fine', -100, 100, 0, 'ct'], ['fine', 'High fine', -100, 100, 0, 'ct'], ['split', 'High/low split', 1, 100, 40, ''], ['balance', 'High/low balance', 0, 100, 50, ''], SP, W],
      'lowFine@0@9C@64@-100@100 shift@3@E8@18@-24@24 fine@5@9C@64@-100@100 split@8@01@64@1@100 balance@9@00@64@0@100 spread@10@9C@64@-100@100 wet@11@00@64@0@100 lowShift@13:7-2@E8@18@-24@24');
    add('S4', 'Rotary Speaker OD', 'rot', 'rotod', ROT.concat([['od', 'Overdrive', 'sel', ['Off', 'On'], 1], ['odGain', 'Overdrive gain', 0, 50, 25, ''], ['odLevel', 'Overdrive level', 0, 50, 35, '']]),
      'odGain@1:5-0@00@32@0@50 odLevel@0:3-0,1:7-6@00@32@0@50 fast@2:2@00@01@0@1 acc@5@00@64@0@100 balance@7@00@64@0@100 mic@8:6-0@00@32@0@100 wet@10@00@64@0@100 od@11:7@00@01@0@1');
    add('S4', 'Early Reflections', 'reverb', 'er', ER(1600), ER_SPEC('FA', 1600));
    add('S4', 'L/C/R Long Delay', 'delay', 'lcr', LCR(2730), LCR_SPEC('AAA', 2730));
    add('S4', 'Stereo Long Delay', 'delay', 'stereo', STD(1360), STD_SPEC('3520', 1360));
    add('S4', 'Dual Long Delay', 'delay', 'dual', DUAL.map(p => /^time/.test(p[0]) ? [p[0], p[1], 0, 1360, 500, 'ms'] : p), DUAL_SPEC('3520', 1360));
    add('S4', 'St. Tempo Delay', 'delay', 'tempo', TDLY, TDLY_SPEC);
    add('S4', 'Hold Delay', 'delay', 'hold', [['loop', 'Loop time', 0, 2700, 1000, 'ms'], ['hsrc', 'Hold control', 'src', null, 14], ['pan', 'Pan', -100, 100, 0, ''], W], 'pan@4@9C@64@-100@100 wet@7@00@64@0@100 loop@14,15@00@0A8C@0@2700');
    // ---- Master Effect 1: modulation (6) ----
    add('MM', 'Flanger', 'mod', 'flanger', [['delay', 'Delay time', 0, 50, 3, 'ms'], LW, SH, PH, LF, DP, FB, HD, ['spread', 'Spread', 0, 100, 50, ''], OUTS, TR, LO, HI],
      'delay@0@00@8C@0@50@dms wave@1:0@00@01@0@1 shape@2@9C@64@-100@100 phase@3@EE@12@-180@180 lfoF@4@01@E6@0.02@20@lfo depth@7@00@64@0@100 fb@8@9C@64@-100@100 hd@9@00@64@0@100 spread@10@00@64@0@100 out@11@9C@64@-100@100 trim@13@00@64@0@100 hi@14:6-2@F1@0F@-15@15 lo@14:1-0,15:7-5@F1@0F@-15@15');
    add('MM', 'Phaser', 'phaser', 'ph', [LW, SH, PH, LF, ['manual', 'Manual', 0, 100, 50, ''], DP, ['reso', 'Resonance', -100, 100, 30, ''], HD, ['spread', 'Spread', 0, 100, 50, ''], OUTS, TR, LO, HI],
      'wave@0@00@01@0@1 shape@1@9C@64@-100@100 phase@2@EE@12@-180@180 lfoF@3@01@E6@0.02@20@lfo manual@6@00@64@0@100 depth@7@00@64@0@100 reso@8@9C@64@-100@100 hd@9@00@64@0@100 spread@10@00@64@0@100 out@11@9C@64@-100@100 trim@13@00@64@0@100 hi@14:6-2@F1@0F@-15@15 lo@14:1-0,15:7-5@F1@0F@-15@15');
    add('MM', 'Multitap Chorus/Dly', 'mod', 'mtc', [['fb', 'Tap 1 feedback', -100, 100, 20, ''], LF, OUT, ['t1', 'Tap 1 time', 0, 127, 20, 'ms'], ['t2', 'Tap 2 time', 0, 127, 40, 'ms'], ['t3', 'Tap 3 time', 0, 127, 60, 'ms'], ['d1', 'Tap 1 depth', 0, 100, 30, ''], ['d2', 'Tap 2 depth', 0, 100, 30, ''], ['d3', 'Tap 3 depth', 0, 100, 30, ''],
      ['l1', 'Tap 1 level', 0, 100, 80, ''], ['l2', 'Tap 2 level', 0, 100, 80, ''], ['l3', 'Tap 3 level', 0, 100, 80, ''], ['p1', 'Tap 1 pan', -6, 6, -6, ''], ['p2', 'Tap 2 pan', -6, 6, 6, ''], ['p3', 'Tap 3 pan', -6, 6, 0, '']],
      'fb@0@9C@64@-100@100 out@3@00@64@0@100 lfoF@4@01@E6@0.02@20@lfo d3@5@00@64@0@100 p3@6:5-2@FA@06@-6@6 p1@8:7-4@FA@06@-6@6 d1@8:3-0,9:7-5@00@64@0@100 d2@9:4-0,10:7-6@00@64@0@100 l3@10:5-0,11:7@00@64@0@100 l1@11:6-0@00@64@0@100 p2@12:7-4@FA@06@-6@6 l2@12:3-0,13:7-5@00@64@0@100 t3@13:4-0,14:7-6@00@7F@0@127 t1@14:5-0,15:7@00@7F@0@127 t2@15:6-0@00@7F@0@127');
    add('MM', 'Ensemble', 'mod', 'ens', [['speed', 'Speed', 1, 100, 40, ''], DP, OUT, ['shimmer', 'Shimmer', 0, 100, 30, '']], 'speed@0@01@64@1@100 depth@1@00@64@0@100 out@2@00@64@0@100 shimmer@15@00@64@0@100');
    add('MM', 'Chorus', 'mod', 'stchorus', [LF, PH, ['pdL', 'L pre delay', 0, 50, 8, 'ms'], ['pdR', 'R pre delay', 0, 50, 12, 'ms'], LW, DP, SP, OUTS, TR, LO, HI],
      'lfoF@0@01@E6@0.02@20@lfo phase@1@EE@12@-180@180 pdL@2@00@8C@0@50@dms pdR@3@00@8C@0@50@dms wave@4:7@00@01@0@1 depth@4:6-0@00@64@0@100 spread@5@9C@64@-100@100 out@6@9C@64@-100@100 trim@10@00@64@0@100 hi@11:6-1@F1@0F@-15@15 lo@11:0,12:7-3@F1@0F@-15@15');
    add('MM', 'L/C/R Delay', 'delay', 'lcr', [T(1360, 'timeL', 'L delay time'), T(1360, 'timeC', 'C delay time'), T(1360, 'timeR', 'R delay time'), ['lvlL', 'L level', 0, 50, 35, ''], ['lvlC', 'C level', 0, 50, 50, ''], ['lvlR', 'R level', 0, 50, 35, ''], FB, HD, LD, ['spread', 'Spread', 0, 50, 50, ''], OUT],
      'fb@0@9C@64@-100@100 lvlC@1:7-1@00@32@0@50 lvlL@1:0,2:7-2@00@32@0@50 timeL@2:1-0,3@00@2A8@0@680 hd@4:7-1@00@64@0@100 lvlR@5:0,6:7-2@00@32@0@50 timeC@6:1-0,7@00@2A8@0@680 spread@8:7-1@00@32@0@50 ld@9:0,10:7-2@00@64@0@100 timeR@10:1-0,11@00@2A8@0@680 out@14@00@64@0@100');
    // ---- Master Effect 2: reverb / delay (8) ----
    add('MR', 'L/C/R Long Delay', 'delay', 'lcr', [T(2000, 'timeL', 'L delay time'), T(2000, 'timeC', 'C delay time'), T(2000, 'timeR', 'R delay time'), ['lvlL', 'L level', 0, 50, 35, ''], ['lvlC', 'C level', 0, 50, 50, ''], ['lvlR', 'R level', 0, 50, 35, ''], FB, HD, LD, ['spread', 'Spread', 0, 50, 50, ''], OUT],
      'timeL@0:2-0,1@00@7D0@0@2000 timeC@2:2-0,3@00@7D0@0@2000 timeR@4:2-0,5@00@7D0@0@2000 ld@6:7-1@00@64@0@100 hd@6:0,7:7-2@00@64@0@100 lvlR@7:1-0,8:7-4@00@32@0@50 lvlC@8:3-0,9:7-6@00@32@0@50 lvlL@9:5-0@00@32@0@50 fb@10@9C@64@-100@100 spread@13@00@32@0@50 out@14@00@64@0@100');
    add('MR', 'Delay/Reverb', 'reverb', 'delrev', [T(680, 'timeL', 'L delay time'), T(680, 'timeC', 'C delay time'), T(680, 'timeR', 'R delay time'), ['lvlL', 'L delay level', 0, 30, 20, ''], ['lvlC', 'C delay level', 0, 30, 20, ''], ['lvlR', 'R delay level', 0, 30, 20, ''], FB, ['dhd', 'Delay high damp', 0, 100, 20, '%'], ['dld', 'Delay low damp', 0, 100, 0, '%'],
      ['time', 'Reverb time', 0.1, 10, 2, 's'], HD, ['pd', 'Pre delay', 0, 200, 30, 'ms'], ['pdt', 'Pre delay thru', 0, 30, 0, ''], ['trim', 'EQ trim', 0, 30, 30, ''], HI, ['spread', 'Spread', 0, 30, 20, ''], OUT],
      'fb@0@9C@64@-100@100 lvlC@1:7-3@00@1E@0@30 timeC@1:2-0,2:7-4@00@7F@0@680 lvlL@2:3-0,3:7@00@1E@0@30 timeL@3:6-0@00@7F@0@680 pdt@4:7-3@00@1E@0@30 pd@4:2-0,5:7-3@00@C8@0@200 dhd@5:2-0,6:7-4@00@64@0@100 lvlR@6:3-0,7:7@00@1E@0@30 timeR@7:6-0@00@7F@0@680 trim@9:2-0,10:7-6@00@1E@0@30 time@10:5-0,11:7@01@64@0.1@10 dld@11:6-0@00@64@0@100 out@12:1-0,13:7-3@00@64@0@100 spread@13:0,14:7-4@00@1E@0@30 hi@14:3-0,15:7@F1@0F@-15@15 hd@15:6-0@00@64@0@100');
    add('MR', 'Reverb-Room', 'reverb', 'room', MREV(3), MREV_SPEC(0x1E));
    add('MR', 'Reverb-Bright Room', 'reverb', 'bright', MREV(3), MREV_SPEC(0x1E));
    add('MR', 'Reverb-Hall', 'reverb', 'hall', MREV(10), MREV_SPEC(0x64));
    add('MR', 'Reverb-Smooth Hall', 'reverb', 'smooth', MREV(10), MREV_SPEC(0x64));
    add('MR', 'Reverb-Wet Plate', 'reverb', 'wetplate', MREV(10), MREV_SPEC(0x64));
    add('MR', 'Reverb-Dry Plate', 'reverb', 'dryplate', MREV(10), MREV_SPEC(0x64));
    L.forEach(e => { e.id = e.grp + ':' + e.idx; e.master = e.grp === 'MM' || e.grp === 'MR'; });
    TFX._cat = L;
    return L;
  }
  static get SIZE() { return { S1: 1, S2: 2, S4: 4, MM: 0, MR: 0 }; }
  static get SRC_NAMES() {
    // Trinity dynamic-modulation sources, in the order of the Trinity Effect Manual p.14-15 (0 None ... 25 Tempo);
    // 26-35 are the extra controllers of Triton programs (the Knob 2 source is MIDI CC#19, number 24)
    return ['None', 'Gate1', 'Gate1+Sus', 'Gate2', 'Gate2+Sus', 'Note No.', 'Velocity', 'AftrTouch', 'JS(+Y)', 'JS(−Y)', 'JS(X)', 'Ribbon(X)', 'Ribbon(Z)',
      'SW1 (CC80)', 'SW2 (CC81)', 'Foot SW (CC82)', 'Foot Pedal (CC4)', 'SustainPdl', 'MIDI Vol (CC7)', 'MIDI Pan (CC10)', 'MIDI Exp (CC11)', 'MIDI Cnt1 (CC12)', 'MIDI Cnt2 (CC13)', 'Slider (CC18)', 'MIDI CC#19', 'Tempo',
      'Knob 1 (CC17)', 'Knob 3 (CC20)', 'Knob 4 (CC21)', 'Knob 1 [+]', 'Knob 2 [+] (CC19)', 'Knob 3 [+]', 'Knob 4 [+]', 'Portamento SW (CC65)', 'Sostenuto (CC66)', 'MIDI CC#83'];
  }
  // Korg effect LFO frequency: 0.01 Hz steps up to 1 Hz, 0.1 Hz steps up to 10 Hz, 0.25 Hz steps up to 20 Hz (raw 1..230)
  static lfoHz(r) { return r <= 99 ? 0.01 * (Math.max(1, r) + 1) : r <= 189 ? 1 + (r - 99) * 0.1 : Math.min(20, 10 + (r - 189) * 0.25); }
  static byId(id) { return TFX.CAT.find(e => e.id === id) || null; }
  static defaults(id) { const e = TFX.byId(id), p = {}; if (e) e.params.forEach(q => { p[q[0]] = q[2] === 'sel' || q[2] === 'src' ? (q[4] || 0) : q[4]; }); return p; }
  static slot(id, on) { return { on: on === undefined ? 1 : on, type: id, p: TFX.defaults(id) }; }
  static decode(id, bytes) {
    const e = TFX.byId(id), p = TFX.defaults(id);
    if (!e || !e.spec) return { p, partial: true };
    const q = TFX.decodeSpec(e.spec, bytes); Object.assign(p, q);
    return { p, partial: Object.keys(q).length < e.params.length };
  }
  static decodeSpec(spec, bytes) {
    const p = {};
    for (const s of spec.split(/\s+/)) {
      if (!s) continue;
      const [key, ch, rmin, rmax, vmin, vmax, log] = s.split('@');
      let raw = 0, bits = 0;
      for (const c of ch.split(',')) {
        const [o, r] = c.split(':'), b = bytes[+o] | 0;
        let hi = 7, lo = 0; if (r !== undefined) { const m = r.split('-'); hi = +m[0]; lo = m.length > 1 ? +m[1] : hi; }
        const w = hi - lo + 1; raw = raw * (1 << w) + ((b >> lo) & ((1 << w) - 1)); bits += w;
      }
      let a = parseInt(rmin, 16), z = parseInt(rmax, 16);
      // a signed field: rawMin is written as an 8-bit two's-complement number, the field itself may be narrower
      if (a > z) { if (a >= 128) a -= 256; const m = 2 ** bits; if (raw >= m / 2) raw -= m; }
      raw = Math.max(a, Math.min(z, raw));
      const v0 = +vmin, v1 = +vmax, t = z === a ? 0 : (raw - a) / (z - a);
      if (log === 'lfo') p[key] = TFX.lfoHz(raw);
      else if (log === 'dms') p[key] = raw <= 100 ? raw / 10 : 10 + (raw - 100);
      else p[key] = log ? v0 * Math.pow(v1 / v0, t) : v0 + (v1 - v0) * t;
      p[key] = Math.round(p[key] * 1e4) / 1e4;
    }
    return p;
  }
  static rack() {
    return { ins: [], ifxPan: 64, ifxWidth: 127, ifxSend1: 0, ifxSend2: 40, send1: 0, send2: 40, m1: { on: 0, type: 'MM:4', p: TFX.defaults('MM:4'), ret: 127, pan: 50, cascade: 0 },
      m2: { on: 1, type: 'MR:5', p: TFX.defaults('MR:5'), ret: 110, pan: 50 }, eqLo: 0, eqHi: 0 };
  }
  static fromLegacy(fx) {
    const r = TFX.rack(); if (!fx) return r;
    const map = { chorus: 'S2:13', flanger: 'S2:17', phaser: 'S2:20', drive: 'S1:4' };
    if (fx.ins && map[fx.ins]) { const s = TFX.slot(map[fx.ins]); s.p.wet = Math.round((fx.insMix === undefined ? 50 : fx.insMix) / 99 * 100); r.ins.push(s); r.ifxSend1 = r.send1; r.ifxSend2 = r.send2; }
    if (fx.dlyMix > 0) { r.m1 = { on: 1, type: 'MM:5', p: TFX.defaults('MM:5'), ret: 127, pan: 50, cascade: 0 }; const t = Math.min(680, fx.dlyTime || 375); Object.assign(r.m1.p, { timeL: t * 0.75, timeC: t, timeR: t * 1.5 > 680 ? t : t * 1.5, fb: fx.dlyFb || 30, out: 100 }); r.send1 = r.ifxSend1 = Math.round(fx.dlyMix / 99 * 127); }
    if (fx.revMix > 0) { r.m2.p.time = 0.8 + (fx.revSize || 50) / 99 * 4; r.m2.p.hd = fx.revDamp === undefined ? 30 : fx.revDamp; r.send2 = r.ifxSend2 = Math.round(Math.min(127, fx.revMix / 99 * 190)); } else { r.m2.on = 0; }
    return r;
  }
}
if (typeof module !== 'undefined') module.exports = { TFX };
