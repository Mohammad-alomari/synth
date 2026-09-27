TRINITY WEB SYNTH - PROJECT CONTEXT FOR CLAUDE CODE
(written 2026-09-27; hand this file to Claude Code together with the repository / zip)

==============================================================================
1. WHAT THIS IS
==============================================================================
A browser model of the Korg Trinity V3 (with the DSP-MOSS-TRI board). One self-contained page
(index.html) built from plain JS files. It imports Korg .PCG files and plays:
  - MOSS programs (Bank M): 13 oscillator models, filters, EGs, LFOs, mod matrix, Trinity effects.
  - PCM ("ACCESS") programs (Banks A-D): Single/Double/Drum mode, own filters/EGs/LFOs/effects.
    Korg's sample ROM is NOT available -> stand-in recordings (General MIDI, MIT licence) or built-in waves.
  - Drum kits (per-key drum samples -> General MIDI drum stand-ins).
  - Combinations (8 timbres, zones, mix, insert chains, master effects).

Owner: Mohammad Alomari (GitHub: Mohammad-alomari). Plays Arabic music (mijwiz, zurna, rababa, oud,
kanun, darbuka...). Owns a Trinity V3 with MOSS. His PCG files are built in (Hadi2024, KJ4TRINI, TRIN-2KJ,
TRIN_3KJ, TRINI-1-KJ, an Arabic-named file). Timezone Europe/Berlin.
Working preferences: do ONE task at a time and finish it; answer questions briefly; ask before building
big new features.

Live published page (claude.ai artifact, private): https://claude.ai/artifact/NfWhX8WGhgjyWaUww83WsU
(last published: Version 15). GitHub: private repo Mohammad-alomari/synth (project files at the repo root).
Keep the repo PRIVATE: pcgdata.js contains Korg's factory
EXB-MOSS bank; tridata.js contains the user's own files.

==============================================================================
2. FILES
==============================================================================
index.html     built page (do not edit; rebuilt by build.py). Loads samples/ at run time.
ui.html        template: layout + CSS; sources are inserted at %%PATCHES%% %%ENGINE%% %%KORG%% %%PCG%% %%APP%%
build.py       parts = PATCHES: fxcat.js patches.js | ENGINE: engine.js pcm.js combi.js fxdsp.js |
               KORG: pcmmap.js korg.js | PCG: pcgdata.js tridata.js | APP: app.js
app.js         UI: pages, keyboard, joystick, MIDI, program list, PCG import, sample loader, audio start-up,
               PCM pages, combination pages, drum-kit table.
engine.js      MossEngine (host), MossVoice (MOSS models), MD helpers, limiter. Voice pools: 16 MossVoice or
               32 PcmVoice (16 in Double mode). Delegates to MossCombi when patch.kind === 'combi'.
pcm.js         PCM static helpers + calibration, PcmEG, PcmLFO, PcmStore (stand-in map, packs, built-in
               waves, 'need' set), PcmVoice (sample playback, SVF filters, drum kits, excl groups).
combi.js       MossCombi: one "dry" MossEngine per timbre, zones, timbre mix, insert chains, master FX.
fxcat.js       Trinity effect catalogue (names, params, byte layout). fxdsp.js: effect DSP + FxRack
               (FxRack.master(L,R,n,fx,bus1,bus2) lets combis feed their own send buses).
patches.js     MOSS patch model, default patch, starter programs (Mijwiz, Rababa Bedouin (Do) etc.).
korg.js        PCG reader; decoders: korgDecodeMoss (521 B), korgTrinitySections, korgDecodePcm (433 B),
               korgDecodeKit (1426 B), korgDecodeCombi (388 B), korgDecodeFxBlocks, korgCombiChains.
pcmmap.js      PCM_STANDIN.ms (multisample 0-374 -> stand-in), PCM_STANDIN.ds (drum sample 0-258 -> GM drum),
               PCM_RAMGUESS (RAM/Flash samples guessed from program name), PCM_MS_NAMES (Korg names 0-374).
pcgdata.js     built-in MOSS banks (base64): Korg factory EXB-MOSS (Triton format) + user's 4 Bank M files.
tridata.js     built-in Trinity data (base64): user's PCM banks, kits, combinations (TRI_BUILTIN).
samples/       111 MP3 packs (mono 32 kHz 48 kb/s; gmNNN = GM program NNN 0-based; kit_std/elec/808/brush/orch)
               + packs.json {packs:{name:{file,rate,sync,search,heal,s:[[start,len,loopStart,loopEnd,gainDb,
               [[lo,hi,root,tune]]]]}}}. A sync click at the start aligns decode offsets; loop seams healed 64 frames.
tools/samples/ build_packs.py (+pack.py, extract_sf.py, sf2parse.py...) rebuilds samples/ from MuseScore
               MS General SoundFont FluidR3Mono_GM.sf3 (set SF3=path). Needs ffmpeg.
docs/research/ format notes: 01 PCM program 433, 02 combination 388, 03 drum kit 1426, 04 global,
               05 PCG file format, 06 effects, 07 multisample names 0-414, 08/09 factory program/combi names.
test/          Node + Playwright tests (see section 6). demos/: two WAV demos.

Conventions / gotchas
- The AudioWorklet source is generated from class.toString() (ENGINE_CLASSES in app.js). Engine code must
  be classes with static methods; no module-level helpers in engine files. Add new engine classes to
  ENGINE_CLASSES, build.py, test/harness.js ORDER.
- build.py strips lines starting with "if (typeof module !== 'undefined')" -> keep each module.exports on ONE line.
- Messages to the engine: patch, set (path,v), on, off, cc, bend, at, tune, panic, pcmMap, pcmPack (zones,
  transferable buffer), pcmKits. Worklet posts {t:'st', v: voiceStates, need:[pack names]}.
- Program ids in the UI: st:N starter, us:N user, pm:N MOSS bank, pc:N PCM (bank*128+i), cb:N combination.
- Stored in browser localStorage: moss-user-programs, moss-current, moss-pcg (imported MOSS banks),
  moss-tri (whole imported Trinity PCGs, base64). Max 8 imported files.

==============================================================================
3. KORG DATA FORMATS (short; full tables in docs/research/)
==============================================================================
PCG sections: type 0 PCM programs (per bank 2-byte header + 128 x 433), type 1 Bank S (Solo-TRI, 521 B,
not modelled), type 2 combinations (2 B + 128 x 388), type 3 drum kits (2 B + n x 1426), type 4 global
(category names at +146; user scale), type 5 Bank M (MOSS, 521 B). Triton PCGs: only the EXB-MOSS bank used (716 B).

MOSS program (521 B): "Trinity V3 MIDI Implementation" rev 1.0 (Dec 1998), section 2. Stored values in the
patch are Korg's raw numbers (0-99, -99..+99, LFO freq 0-199). Decode checked over 640 programs: consistent.

PCM program (433 B, Korg TABLE 1): name 0-15; 16 category; 17 osc mode b0-1 (0 single,1 double,2 drum),
legato, key assign, hold, priority, piano; 18 OSC2 bottom velocity; OSC1 block 31-167, OSC2 = +137 (168-304).
  Multisample = ((b&0x7F)<<8)|next byte; 0x1000|n = RAM/Flash sample. Drum mode: bytes 33-34 = kit number.
  Insert FX 4 x 22 B at 305; master FX 40 B at 393.
Drum kit (1426 B): name 0-15, then 88 keys (A0..C8) x 16 B at 18+16k: hi sample(2 B, b7=offset), hi tune
  (s8/2 semitones), hi level (-99..99), hi decay, lo same (5 B), pan (FF=off), send1, send2, excl group,
  b14: ifx group/assign/filter bypass, b15: bottom velocity of hi.
Combination (388 B): 16 category; 17 scale; 18 random; 19 panel SW; 20-195 eight insert blocks (22 B);
  196-235 master FX; timbres at 236+19n: prog, bank (0-3 = A-D, 4 = S or M on V3), ch|status (b0-4 ch,
  16 = Global; b5-6 0 int,1 off,2 ext,3 both), level, bend (E7 = PRG), transpose, detune, delay, pan (80 = PRG,
  FF = off), send1/2 (80 = PRG), flags (scale sel, hide OSC2, force poly), key top/bottom, key slopes,
  vel top/bottom, vel slopes, ifx byte.
Insert block (22 B): 0-15 params, 16 type (b0-5 type, b6 on, b7 cascade), 17 size 0..3 = 0/1/2/4,
  18 pan, 19 width, 20 send1, 21 send2. Master block (40 B): FX1 16 params + type/pan/return, FX2 same, low/high EQ.
Timbre ifx byte (UNVERIFIED, inferred from user files; Korg doc incomplete): 0 none; 1/2/3 own chain of
  size 1/2/4; 4 own chain up to 8 units; 5..12 share the chain of timbre 1..8. Chains take used blocks in
  order; with 2 chains and both halves used, first = blocks 1-4, second = 5-8. (korgCombiChains)
Drum sample identities (no Korg list available): inferred from factory kit layouts: Standard/Processed/Jazz
  kits = GM drum map one octave up (C2 kick... F#3 closed hat); Analog/Club kit = GM map at GM pitch;
  Percussion and Orchestra&Ethnic kits hold ethnic/orchestral sounds. See PCM_STANDIN.ds.

==============================================================================
4. CALIBRATION (estimates - verify against real hardware when possible)
==============================================================================
PCM cutoff: PCM.cutHz(x) = 250 * 2^(x/15.6) Hz, clamped 30 Hz..0.45*sr. Filter EG factor EGK = 2.
Filter input gain = value/99. Resonance 0..31 mapped onto MOSS resonance curve (x92/31).
LFO: 0.03 * 1000^(v/99) Hz. EG times: MD.tsec (shared with MOSS). PCM output trim 3.3.
Drum kit level -99..+99 -> -12..+6 dB. Drum decay -> amp EG decay/slope/release x 2^(d/40).
Timbre level -> (level/127)^2; whole combination -3 dB. Voice caps in combis: PCM 32/(active timbres), MOSS 6.
Output: peak limiter (ceiling 0.89, 120 ms release) + soft clip.
UI: MOSS pages show "Trinity number · model estimate" (e.g. "40 · 250 ms"); pan shown Korg-style L000..C064..R127.

==============================================================================
5. CURRENT STATE AND OPEN ITEMS
==============================================================================
Done: MOSS models + effects; PCM engine; 111 stand-in packs; drum kits; combinations; PCG import of
Bank M + PCM banks + kits + combinations; Korg-number display; tests.
Checks passed: all 2,560 PCM programs render (no NaN); 1,408 combinations render (no NaN, 1 silent by data);
MOSS sound identical to Version 11 (regress.js); browser tests in AudioWorklet and ScriptProcessor modes; phone width.

Open / ideas (not built):
1. Synth-memory model: layer imported files like the Trinity's memory (factory preload first, user PCG on
   top); combinations and drum programs resolve programs/kits from that memory. Today they only look inside
   their own file, and a PCG with only combinations is rejected ("nothing this synth can play").
2. Real Trinity allows only ONE MOSS program per combination at a time (Sound On Sound) - not enforced.
3. Combination: timbre Delay start, per-timbre MIDI filters, per-timbre (program) scale not modelled.
4. Bank S (Solo-TRI board) not modelled; timbres pointing to S are silent.
5. RAM/Flash samples (0x1000|n) guessed by program name (PCM_RAMGUESS) - the audio only lived in the user's synth.
6. Drum sample -> GM mapping and the timbre ifx rule are inferred; calibration constants are estimates.
   Korg's Voice Name List PDFs (scans) contain the real drumsample list - could be OCR'd.
7. MOSS: reed/brass "jump pitch bend" (overblowing) played as smooth bend; byte 147 (stepped bend?) unclear.
8. Some user kits in files other than TRINI-1-KJ contain odd values (RAM refs / garbage) -> conga fallback.
9. User's TRINI-1-KJ drum programs point to other kits than their names (e.g. "Standard Kit" -> kit 9
   Orchestra&Ethnic): that is the file's data, not a bug.
Important fact: a PCG holds parameters only, never audio. Korg's ROM samples are on chips in the synth and
are not downloadable; the factory preload would also play stand-ins.

==============================================================================
6. BUILD, RUN, TEST
==============================================================================
Build:   python3 build.py index.html
Run:     python3 -m http.server 8765   then open http://localhost:8765/index.html (Chrome/Edge; needs http for audio,
         MIDI and samples). Web MIDI: Chrome, Edge, Firefox (not Safari).
Tests (Node 18+, ffmpeg for PCM tests):
  sh test/run_all.sh            all offline checks + index.html freshness; exit code 0 = pass (~10 min)
  node test/progs.js            all MOSS programs: NaN, levels, CPU
  node test/combis.js [filter] [max]   all combinations
  node test/voicefix.js | fxfix.js | fuzz.js | fxunit.js | fxfunc.js | models2.js
  node test/regress.js <older copy folder> (fxregress.js: same for effects)   MOSS sample-by-sample regression (env STEP, SECS, ONLY)
     note: its "cpu ... speedup x0.78" is an ordering artefact (same code vs itself shows the same)
  test/harness.js loads sources in a vm (slow with tridata.js; big renders use module._compile instead)
  test/pcmpacks.js decodes samples/ with ffmpeg for Node tests (feed/preload helpers)
Browser tests (Python + Playwright, server on 8765): test/browser4.py (MOSS), browser5.py (PCM),
  browser6.py (drum kits), browser7.py (combinations). window.__moss exposes loadProgram(bank, idx),
  getPatch, noteOn/noteOff, selectPage, engine() (script mode), importPcgFile.

==============================================================================
7. SOURCES AND LINKS
==============================================================================
Korg documentation
- Trinity Parameter Guide incl. MIDI Implementation (scanned pages 173-191: TABLE 1 program, 3 combination,
  4 global, 7 drum kit, 8 song/effect block layout): https://github.com/dave-billin/Toluene (doc/ folder)
  Korg copy: https://www.korg.com/us/support/download/manual/1/213/1708/
- Trinity V3 MIDI Implementation rev 1.0 (Dec 1998), MOSS program 521 bytes (basis of korgDecodeMoss)
- TR-Rack MIDI Implementation (text): https://www.korg.com/us/support/download/manual/1/212/2728/
- Trinity Effects MIDI System Exclusive (per-effect parameter tables): https://www.korg.com/us/support/download/manual/1/213/3298/
- Voice Name Lists (scans; multisample/drumsample/program lists):
  Trinity https://www.korg.com/us/support/download/manual/1/213/1704/
  Trinity V3 https://www.korg.com/us/support/download/manual/1/213/1703/
  TR-Rack https://www.korg.com/us/support/download/manual/1/212/1699/
- Trinity Options Guidebook (PBS-TRI/HDR-TRI/DI-TRI):
  https://cdn.korg.com/us/support/download/files/09191bb1b4d91667196a8750bd827288.pdf
- Factory preload data (licence forbids redistribution; user imports it himself):
  Windows https://www.korg.com/us/support/download/software/1/213/3296/
  Mac     https://www.korg.com/us/support/download/software/1/213/3297/
  (No V3 preload with the factory MOSS bank was found online.)
Open-source references
- PCG Tools (Michel Keijzers, C#, Trinity V2/V3 support): https://github.com/DaBlick/PCG-Tools
- Toluene (JUCE SysEx editor for Trinity/TR-Rack, ParameterIDs.h): https://github.com/dave-billin/Toluene
- TR-Rack Ctrlr editor panel (multisample/program/effect name lists): https://github.com/FRDTom/TR-Rack-Editor
Samples
- MuseScore MS General SoundFont (FluidR3Mono_GM.sf3), MIT licence (FluidR3 by Frank Wen, FluidR3Mono by
  Michael Cowgill, MS General by S. Christian Collins).
Background
- Sound On Sound, Korg Trinity V3 DRS review (MOSS = DSP models only, no samples; combis mix ACCESS + one MOSS):
  https://www.soundonsound.com/reviews/korg-trinity-v3-drs
- Korg Z1 (same MOSS engine, 13 models, no PCM): https://en.wikipedia.org/wiki/Korg_Z1
- Korg Trinity overview: https://en.wikipedia.org/wiki/Korg_Trinity
