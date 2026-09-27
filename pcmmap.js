// ===== Stand-ins for the Trinity's sample ROM =====
// Korg's multisamples are not available, so each one is played by the closest openly licensed
// recording (General MIDI instruments from MuseScore's FluidR3-based "MS General" SoundFont, MIT licence) or, for
// the Trinity's synthetic waves (saw, pulse, square, sine, DWGS, noise ...), by a band-limited waveform built here.
// Entry forms:  { p: pack }  a recorded instrument;  { p: pack, k: key }  one drum sound played as a pitched sample
// (key 60 = its own pitch);  { syn: name }  a built-in waveform;  r: shift in semitones (the stand-in sounds r lower);
// g: level trim in dB.  Pack names: gmNNN = General MIDI program NNN (0-based), kit_* = General MIDI drum sets
// (used by the percussion multisamples 333-374).
const PCM_STANDIN = (() => {
  const ms = {}, set = (a, b, e) => { for (let i = a; i <= b; i++) ms[i] = e; }, gm = n => ({ p: 'gm' + String(n).padStart(3, '0') });
  const G = (n, extra) => Object.assign(gm(n), extra || {}), D = (k, kit, extra) => Object.assign({ p: kit || 'kit_std', k }, extra || {}), S = (syn, g) => ({ syn, g: g || 0 });
  // keyboards
  set(0, 0, G(0)); set(1, 1, G(1)); set(2, 2, G(2)); set(3, 6, G(5)); set(7, 15, G(4)); set(16, 17, G(4, { g: -1 })); set(18, 22, G(88));
  set(23, 23, G(7)); set(24, 26, G(6));
  // organs
  set(27, 30, G(17)); set(31, 33, G(16)); set(34, 34, S('organ3')); set(35, 35, S('organ1')); set(36, 36, G(16)); set(37, 38, G(18)); set(39, 39, G(16));
  set(40, 41, S('organ5')); set(42, 43, G(19)); set(44, 44, G(20)); set(45, 46, G(19));
  // mallets, bells, percussion instruments
  set(47, 48, G(108)); set(49, 50, G(10)); set(51, 52, G(12)); set(53, 54, G(13)); set(55, 56, G(11)); set(57, 58, G(8)); set(59, 59, G(112)); set(60, 60, G(9));
  set(61, 62, G(14)); set(63, 64, G(115)); set(65, 66, G(12)); set(67, 68, G(115, { r: 12 })); set(69, 70, G(115)); set(71, 72, G(98)); set(73, 74, G(114));
  set(75, 77, G(11)); set(78, 79, G(112)); set(80, 81, G(14)); set(82, 82, G(98)); set(83, 84, G(112)); set(85, 86, G(113)); set(87, 88, G(98));
  set(89, 90, G(98)); set(91, 93, G(14));
  // woodwinds
  set(94, 94, G(73)); set(95, 95, G(72)); set(96, 97, G(72)); set(98, 98, G(75)); set(99, 99, G(77)); set(100, 101, G(76)); set(102, 102, G(74)); set(103, 103, G(79));
  set(104, 104, G(71)); set(105, 105, G(71, { r: 12 })); set(106, 106, G(68)); set(107, 107, G(69)); set(108, 108, G(70)); set(109, 109, G(67)); set(110, 112, G(66));
  set(113, 114, G(65)); set(115, 116, G(64)); set(117, 117, G(66)); set(118, 119, G(66));
  // brass
  set(120, 121, G(60)); set(122, 122, G(58)); set(123, 125, G(57)); set(126, 126, G(59, { r: 7 })); set(127, 129, G(56)); set(130, 130, G(59)); set(131, 131, G(56, { r: -12 }));
  set(132, 134, G(61)); set(135, 135, G(62));
  // reeds, voices
  set(136, 137, G(21)); set(138, 138, G(23)); set(139, 139, G(21)); set(140, 140, G(22)); set(141, 141, G(109));
  set(142, 142, G(52)); set(143, 143, G(53)); set(144, 144, G(52)); set(145, 146, G(53)); set(147, 148, G(54));
  // strings
  set(149, 150, G(48)); set(151, 151, G(45)); set(152, 152, G(40)); set(153, 153, G(41)); set(154, 154, G(42)); set(155, 156, G(49)); set(157, 157, G(45)); set(158, 158, G(110));
  // guitars
  set(159, 159, G(24)); set(160, 162, G(25)); set(163, 163, G(31)); set(164, 164, G(25)); set(165, 168, G(27)); set(169, 170, G(28)); set(171, 173, G(27)); set(174, 175, G(26));
  set(176, 176, G(26)); set(177, 177, G(31)); set(178, 178, G(30)); set(179, 179, G(31)); set(180, 181, G(29)); set(182, 182, G(30)); set(183, 183, G(120)); set(184, 184, S('noise_lo', -12));
  // basses
  set(185, 187, G(32)); set(188, 191, G(33)); set(192, 197, G(34)); set(198, 204, G(36)); set(205, 205, G(35)); set(206, 207, G(33, { r: -12 }));
  // plucked and ethnic
  set(208, 209, G(104)); set(210, 211, G(15)); set(212, 214, G(25, { r: -12 })); set(215, 216, G(104, { r: -5 })); set(217, 218, G(105)); set(219, 219, G(106)); set(220, 220, G(107));
  set(221, 225, G(46)); set(226, 227, G(24, { r: -12 }));
  // synth basses and waves
  set(228, 229, G(38)); set(230, 231, S('reso_bass')); set(232, 237, S('fm_bass')); set(238, 238, S('reso_bass')); set(239, 239, G(39));
  set(240, 240, S('sync1')); set(241, 241, S('sync2')); set(242, 243, S('sync3')); set(244, 245, G(81)); set(246, 246, G(90));
  set(247, 248, G(50)); set(249, 250, G(104)); set(251, 251, G(84)); set(252, 252, G(80)); set(253, 253, G(91)); set(254, 255, G(89)); set(256, 256, G(89));
  set(257, 257, G(95)); set(258, 258, G(101)); set(259, 262, G(95)); set(263, 263, G(88)); set(264, 264, D(75));
  set(265, 265, S('noise')); set(266, 266, S('noise_hi')); set(267, 267, S('noise_lo'));
  set(268, 268, S('saw')); set(269, 271, S('saw_mg')); set(272, 272, S('pulse2')); set(273, 273, S('pulse5')); set(274, 274, S('pulse8')); set(275, 275, S('pulse16'));
  set(276, 276, S('pulse33')); set(277, 277, S('pulse40')); set(278, 280, S('square')); set(281, 282, S('square_jp')); set(283, 284, S('tri')); set(285, 286, S('ramp'));
  set(287, 287, S('parabolic')); set(288, 290, S('sine')); set(291, 292, S('sine2'));
  set(293, 293, S('ep1')); set(294, 294, S('ep2')); set(295, 297, S('ep3')); set(298, 298, S('organ1')); set(299, 299, S('organ2')); set(300, 300, S('organ3')); set(301, 301, S('organ4'));
  set(302, 302, S('organ5')); set(303, 303, S('organ4')); set(304, 305, S('guitar')); set(306, 307, S('bell1')); set(308, 309, S('bell2')); set(310, 312, S('clav'));
  set(313, 313, S('digi1')); set(314, 314, S('digi2')); set(315, 315, S('digi3')); set(316, 317, S('wire')); set(318, 318, S('sync1')); set(319, 319, S('sync2')); set(320, 320, S('sync3'));
  // effects and hits
  set(321, 321, G(92)); set(322, 322, G(102)); set(323, 323, G(124)); set(324, 324, G(118)); set(325, 326, G(13)); set(327, 327, G(123)); set(328, 328, G(122));
  set(329, 331, G(55)); set(332, 332, G(47));
  // drum and percussion multisamples (played as pitched samples; C4 = the sound's own pitch)
  set(333, 334, D(49)); set(335, 335, G(119)); set(336, 336, D(57, 'kit_orch')); set(337, 339, D(51)); set(340, 340, D(42)); set(341, 341, D(46, 'kit_808')); set(342, 342, D(56, 'kit_808'));
  set(343, 343, D(45, 'kit_808')); set(344, 344, D(63, 'kit_808')); set(345, 345, D(49, 'kit_808')); set(346, 346, D(45)); set(347, 347, D(45, 'kit_brush')); set(348, 349, D(45, 'kit_elec'));
  set(350, 351, G(118)); set(352, 352, S('noise_hi', -18)); set(353, 353, G(112)); set(354, 354, D(54)); set(355, 355, D(67)); set(356, 356, D(56)); set(357, 357, D(81));
  set(358, 358, D(83)); set(359, 360, D(84)); set(361, 361, D(70)); set(362, 363, G(113)); set(364, 364, D(76)); set(365, 365, G(116)); set(366, 366, D(63)); set(367, 367, D(62));
  set(368, 368, G(14, { r: 24 })); set(369, 370, G(126)); set(371, 371, G(127)); set(372, 372, G(125)); set(373, 374, G(123));
  // RAM/Flash samples of user programs (not in the file): guessed from the program name, see PCM_RAMGUESS
  return { ms };
})();

// Programs that play RAM/Flash samples (loaded from disk into the Trinity, not saved in the PCG): the stand-in is
// chosen from the program's name. [pattern, ROM multisample used instead]
const PCM_RAMGUESS = [
  [/zmr|zamr|mizmar|zorna|zurna|mgoz|mjoz|shbab|shabab|zmar/i, 106],          // double reed: oboe-like
  [/mjw|mijw|megwez|mejwez|yrgol|yrkol|yargool|yarghul|arghul/i, 104],        // single-reed pipes: clarinet
  [/kasb|kasab|ksba|nay|ney|nai|kawal|shababa/i, 99],                          // end-blown flute: shakuhachi
  [/kanon|kanoon|qanun|kanun|santur/i, 210],                                   // zither
  [/oud|aoud|3od|baglama|saz|bozk|bouzouki|buzuq/i, 215],                      // lutes
  [/kaman|kamaan|violin|kamanja/i, 152], [/rbab|rabab|rbaba/i, 158],
  [/accor|akkor|acord/i, 139], [/tabl|darb|drum|daf|riq/i, 344], [/piano/i, 0], [/str/i, 149], [/bass/i, 188]
];

// Trinity ROM multisample names (0-374), from the TR-Rack editor panel by Tom Harper (typed from Korg's voice name list)
const PCM_MS_NAMES = ["A.Piano", "A.Piano-ff. Atk", "E.Grand Piano", "E.P-FM 1", "E.P.-FM 1 LP", "E.P.-FM 2", "E.P.-FM 3", "E.P.-Dyno Soft", "E.P.-Dyno Sft LP", "E.P.-Dyno Medium", "E.P. Dyno Med LP", "E.P. Dyno Hard", "E.P.-Stage Soft", "E.P-Sta Soft LP", "E.P.-Stage Hard", "E.P-Sta Hard LP", "E.P. Wurly", "E.P.-Wurly LP", "E.P. Pad 1", "E.P. Pad 1 LP", "E.P. Pad 2", "E.P. Pad 3", "E.P. Pad 3 LP", "Clavinet", "Harpsichord-Sngl", "Harpsichord-Dbl", "Harpsi-Keyoff", "E.Organ Perc 1", "E.Organ Perc 2", "E.Organ Perc 3", "E.Organ-2 Perc", "E.Organ-Jazz 1", "E.Organ-Jazz 2", "E.Organ-Jazz 3", "E.Organ-Vox", "E.Organ-Soft", "E.Organ-Medium", "E.Organ-Full", "E.Organ Dist", "E.Organ-BX 3", "Positive 1", "Positive 2", "Pipe-Mixture 1", "Pipe-Mixture 2", "Pipe-Reed", "Pipe Tuentiana", "Pipe-Full", "Kalimba", "Kalimba Mute", "Music Box", "Music Box LP", "Marimba", "Marimba LP", "Xylophone", "Xylophone LP", "Vibraphones", "Vibraphone LP", "Celesta", "Celesta LP", "Chime", "Glockenspiel LP", "Tubular Bell", "FM Tubular", "Slit Drum", "Slit Drum LP", "Balaphones", "Balaphone LP", "Guntan", "Guntan LP", "Bottle Pop", "Bottle Pop LP", "FM Pluck", "FM Pluck LP", "Steel Drum", "Steel Drum LP", "Gamelan 1", "Gamelan 1 LP", "Gamelan 2", "Finger Cymbal", "Finger Cymbal LP", "Tibetan Bell", "Tibetan Bell LP", "FM Bell", "Thai Bell", "Thai Bell LP", "Pot covers", "Pot Cover LP", "FM Solar", "FM Chiff", "Glass Bell", "FM Glass Bell", "Ensemble Bell 1", "Ens. Bell 1 LP", "Ensemble Bell 2", "Flute", "Piccolo", "Tin Flute", "Tin Flute LP", "Pan Flute", "Shakuhachi", "Bottle", "Bottleizer", "Recorder", "Ocarina", "Clarinet", "Bass Clarinet", "Oboe", "English Horn", "Bassoon", "Baritone Sax", "Tenor Sax-Soft", "Tenor Sax-Medium", "Tenor Sax-Hard", "Alto Sax Soft", "Alto Sax-Hard", "Soprano Sax-Soft", "Soprano Sax-Hard", "Sax Grow!", "Saxophone ensemble", "Sax Ensemble LP", "French Horn", "Wing Horn", "Tuba", "Trombone-Soft", "Trombone-Medium", "Trombone-Hard", "Trombone-Muted", "Trumpet-Soft", "Trumpet-Medium", "Trumpet-Hard", "Trumpet-Muted", "Piccolo Trumpet", "Brass Ensemble1", "Brass Ensemble2", "Brass Ens.-Fall", "Brass-Pad", "Musette", "Musette LP", "Bandoneon", "Accordion", "Harmonica", "Bag Pipe", "Voice-Choir", "Voice-Pop Ooh", "Voice-Pop Ah", "Voice-Doo", "Voice-Doo LP", "Voice Wave 1", "Voice Wave 2", "String Ens. 1", "Strings Ens. 2", "Pizzicato Ens.", "Violin", "Viola", "Cello&Contrabass", "String Quartet 1", "String Quartet 2", "Pizzicato", "Kokyu", "Nylon Guitar", "A.Guitar-Finger", "A.Guitar-Pick", "12 String Guitar", "A.Gtr-Harmonics", "ParkerGtr-Piezo", "Clean Gtr 1-Stra", "Clean Gtr 2-Stra", "Clean Gtr 3-Tele", "Clean Gtr 4-Prkr", "Clean Gtr-Mute 1", "Clean Gtr-Mute 2", "Funky Gtr 1-Stra", "Funky Gtr 2-Stra", "Funky Gtr 3-Prkr", "Jazz Guitar 1", "Jazz Guitar 2", "Pedal Steel Gtr.", "E.Gtr-Harmonics", "Distorted Guitar", "Dist.Gtr-Harmo", "Dist.Gtr-Mute", "Dist.Gtr-Mute LP", "Power Chord", "Fret Noise", "Amp Noise", "A.Bass 1", "A.Bass 2", "A.Bass 2 LP", "Finger Bass 1", "Finger Bass 1 LP", "Finger Bass 2", "Finger Bass 2 LP", "Pick Bass 1", "Pick Bass 1 LP", "Pick Bass 2", "Pick Bass 2 LP", "Pick Bass-Mute", "Pick Bass-MuteLP", "SlapBass-Thumb 1", "SlapBass Thum1LP", "SlapBass-Thumb 2", "SlapBass Thum2LP", "SlapBass pull", "SlapBass mute", "SlapBass Mute LP", "Fretless Bass", "Bass Harmonics", "Bass Harmonic LP", "Sitar", "Sitar&Tambura", "Santur", "Santur LP", "Mandolin", "Mandolin LP", "Mandolin-Tremolo", "Bouzouki", "Bouzouki LP", "Banjo", "Banjo LP", "Shamisen", "Koto", "Harp", "Harp LP", "Harp-Harmonics", "Harp-Harmo LP", "Harp glissando", "Ukulele", "Ukulele LP", "Syn Bass-Oct 1", "Syn Bass-Oct 2", "Syn Bass-Reso 1", "Syn Bass-Reso 2", "Syn Bass-FM 1", "Syn Bass-FM 1 LP", "Syn Bass-FM 2", "Syn Bass-FM 2 LP", "Syn Bass-FM 3", "Syn Bass-FM 3 LP", "Syn Bass-TB", "Syn Bass-Stack", "Sync Wave 1", "Sync Wave 2", "Sync Wave 3", "Sync Wave 4", "Detuned-Super", "Detuned-Saw", "Detuned-PWM", "Analog Strings 1", "Analog Strings 2", "Syn-Ethnic", "Syn-Ethnic LP", "Syn-Clavitar", "Syn pop", "Syn-Vocalscape", "Syn-Air Pad", "Syn-Air", "Syn-Flute Pad", "Syn-Air Vortex", "Syn-Ghostly", "Syn-Sweep 1", "Syn-Sweep 2", "Syn-Sweep 3", "Syn-Sweep 3 LP", "Syn-Magic Bell", "Syn-Clicker", "Noise", "Noise Spectrum 1", "Noise Spectrum 2", "Saw", "Saw-MG3", "Saw-mMG", "Saw-Chroma", "Pulse-2%", "Pulse-5%", "Pulse-8%", "Pulse-16%", "Pulse-33%", "Pulse-40%", "Square", "Square-mMG", "Square-MG3", "Square-JP", "Square-OB", "Triangle", "Triangle-MG3", "Ramp", "Ramp-mMG", "Parabolic", "Sine", "Sine-01/W", "Sine-JP", "DWGS Syn Sine 1", "DWGS Syn Sine 2", "DWGS-E.P. 1", "DWGS-E.P. 2", "DWGS-E.P. 3", "DWGS-E.P.4", "DWGS-E.P. 5", "DWGS-Organ 1", "DWGS-Organ 2", "DWGS-Organ 3", "DWGS-Organ 4", "DWGS-Organ 5", "DWGS-Accordion", "DWGS-Guitar 1", "DWGS-Guitar 2", "DWGS-Bell 1", "DWGS-Bell 2", "DWGS-Bell 3", "DWGS-Bell 4", "DWGS-Clav 1", "DWGS-Clav 2", "DWGS-Clav 3", "DWGS Digi 1", "DWGS Digi 2", "DWGS Digi 3", "DWGS-Wire 1", "DWGS-Wire 2", "DWGS-Sync 1", "DWGS-Sync 2", "DWGS-Sync 3", "Rubbed Glass", "Space Lore", "Telephone Ring", "Cyber Drum", "Xylo Spectrum", "Xylophone tremo.", "Cricket Spectrum", "Swish Terra", "Orchestra Hit", "Band Hit", "Pizz Hit", "Timpani", "Crash 1", "Crash 2", "Cymbal Reverse", "Orch. Cymbal", "Ride-Jazz", "Ride-Edge 1", "Ride-Edge 2", "H.Hat-Closed", "88-HHat Open", "88-Cowbell", "88-Tom", "88-Conga", "88-Crash", "Tom", "Tom-Brush", "Tom-Processed", "Real E Tom", "Zap 1", "Zap 2", "DJ-Old Record", "Flexatone", "Tambourine", "Agogo Bell", "Cowbell", "Triangle-Roll", "SleighBell-Roll", "Marc Tree", "Bell Tree", "Rainstick", "Anklung-One Shot", "Anklung Roll", "TempleBlocks", "Taiko", "Djembe Open", "Djembe mute", "Chinese Gong", "Stadium", "Applause", "GunShot", "Industry", "Birds 1", "Birds 2"];
