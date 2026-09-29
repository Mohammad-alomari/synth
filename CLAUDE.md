TRINITY WEB SYNTH - PROJECT CONTEXT FOR CLAUDE CODE
(written 2026-09-27; hand this file to Claude Code together with the repository / zip)

==============================================================================
1. WHAT THIS IS
==============================================================================
A browser model of the Korg Trinity V3 (with the DSP-MOSS-TRI board). One self-contained page
(index.html) built from plain JS files. It imports Korg .PCG files and plays:
  - MOSS programs (Bank M): 13 oscillator models, filters, EGs, LFOs, mod matrix, Trinity effects.
  - PCM ("ACCESS") programs (Banks A-D): Single/Double mode, own filters/EGs/LFOs/effects.
    Korg's sample ROM is NOT available -> stand-in recordings (General MIDI, MIT licence) or built-in waves.
    In the owner's own copy, ~140 multisamples play Korg recordings instead (samples/korg/, see build_korg.py).
  - Drum kits / Drum-mode programs: REMOVED on purpose (owner's decision). Drum programs are left out of the
    lists; combination timbres that use one are silent ("drum program, not supported"). PCG kit sections are skipped.
  - Combinations (8 timbres, zones, mix, insert chains, master effects).

Owner: Mohammad Alomari (GitHub: Mohammad-alomari). Plays Arabic music (mijwiz, zurna, rababa, oud,
kanun, darbuka...). Owns a Trinity V3 with MOSS. His PCG files are built in (Hadi2024, KJ4TRINI, TRIN-2KJ,
TRIN_3KJ, TRINI-1-KJ, an Arabic-named file). Timezone Europe/Berlin.
Working preferences: do ONE task at a time and finish it; answer questions briefly; ask before building
big new features.

Live published page (claude.ai artifact, private): https://claude.ai/artifact/NfWhX8WGhgjyWaUww83WsU
(last published: Version 15). GitHub: private repo Mohammad-alomari/synth (project files at the repo root).
Keep the repo PRIVATE: pcgdata.js and tridata.js contain the user's own files.
Korg's factory EXB-MOSS bank was removed (licence); the owner imports it himself: https://www.korg.com/us/support/download/software/1/270/3183/
("EXB-MOSS - MOSS Factory Preload Data", MOSS_EXT.PCG, Triton format -> bank F). The public Netlify site (moss-synth) is built with
--public, without the owner's files.

==============================================================================
2. FILES
==============================================================================
index.html     built page (not committed, .gitignore; build with build.py). Loads samples/ at run time.
ui.html        template: layout + CSS; sources are inserted at %%FONTS%% %%PATCHES%% %%ENGINE%% %%KORG%% %%PCG%% %%APP%%
build.py       parts = PATCHES: fxcat.js patches.js | ENGINE: engine.js pcm.js combi.js fxdsp.js |
               KORG: pcmmap.js korg.js | PCG: pcgdata.js tridata.js | APP: app/*.js (APP_FILES order, wrapped in ONE
               function scope by build.py) | FONTS: fonts/*.woff2 inlined as base64 @font-face (fonts/fonts.json).
app/           UI, split by section (was app.js): core.js (storage, PCG banks, synth memory, audio start-up, sample
               loader), pages.js (all editor pages), program.js (program list + search, LCD, flow, scope), scale.js,
               keyboard.js (notes, on-screen keys, Keyboard page, joystick/ribbon/SW, play mode, wake lock, Sustain),
               record.js (AudioWorklet recorder, ScriptProcessor fallback), midi.js, midimode.js (MIDI mode), boot.js (last; service worker).
               The files are fragments of one scope: top-level names are shared, file order matters.
manifest.webmanifest, sw.js, icons/  installable app (PWA). sw.js: network-first for the page, cache-first for
               samples/*.mp3. Netlify copies them next to index.html. tools/make_icons.py draws the icons.
package.json, eslint.config.js  npm run lint (ESLint 10; the config collects each file's top-level names as globals).
engine.js      MossEngine (host), MossVoice (MOSS models), MD helpers, limiter. Voice pools: 16 MossVoice or
               32 PcmVoice (16 in Double mode). Delegates to MossCombi when patch.kind === 'combi'.
pcm.js         PCM static helpers + calibration, PcmEG, PcmLFO, PcmStore (stand-in map, packs, built-in
               waves, 'need' set), PcmVoice (sample playback, SVF filters).
combi.js       MossCombi: one "dry" MossEngine per timbre, zones, timbre mix, insert chains, master FX.
fxcat.js       Trinity effect catalogue (names, params, byte layout). fxdsp.js: effect DSP + FxRack
               (FxRack.master(L,R,n,fx,bus1,bus2) lets combis feed their own send buses).
patches.js     MOSS patch model, default patch, starter programs (Mijwiz, Rababa Bedouin (Do) etc.).
korg.js        PCG reader; decoders: korgDecodeMoss (521 B), korgTrinitySections, korgDecodePcm (433 B),
               korgDecodeCombi (388 B), korgDecodeFxBlocks, korgCombiChains.
pcmmap.js      PCM_STANDIN.ms (multisample 0-374 -> stand-in; percussion multisamples 333-374 use the kit_* packs),
               PCM_RAMGUESS (RAM/Flash samples guessed from program name), PCM_MS_NAMES (Korg names 0-374),
               PCM_KORG.ms (multisample -> Korg KMP file + pack k_<file>; s:1 = similar recording, else the ROM multisample
               itself). Used instead of PCM_STANDIN when samples/korg/packs.json exists (app/core.js packIndex -> pcmMap).
pcgdata.js     built-in MOSS banks (base64): the user's 4 Bank M files.
tridata.js     built-in Trinity data (base64): user's PCM banks and combinations (TRI_BUILTIN).
samples/       111 MP3 packs (mono 32 kHz 48 kb/s; gmNNN = GM program NNN 0-based; kit_std/elec/808/brush/orch)
               + packs.json {packs:{name:{file,rate,sync,search,heal,s:[[start,len,loopStart,loopEnd,gainDb,
               [[lo,hi,root,tune]]]]}}}. A sync click at the start aligns decode offsets; loop seams healed 64 frames.
tools/samples/ build_packs.py (+pack.py, extract_sf.py, sf2parse.py...) rebuilds samples/ from MuseScore
               MS General SoundFont FluidR3Mono_GM.sf3 (set SF3=path). Needs ffmpeg.
               build_korg.py builds samples/korg/ (NOT committed, not in the public build: Korg's recordings) from the
               owner's copy of Korg's PBS-TRI libraries (KMP/KSF; "Korg Multisamples" disk = 112 Trinity ROM multisamples)
               via ConvertWithMoss (KMP -> SF2) in the Docker image tools/samples/korg/Dockerfile; packs keep the source
               rate (48 kHz) and Korg's loops (pack.py --kind auto). Usage in the script's docstring.
docs/research/ format notes: 01 PCM program 433, 02 combination 388, 03 drum kit 1426, 04 global,
               05 PCG file format, 06 effects, 07 multisample names 0-414, 08/09 factory program/combi names.
test/          Node + Playwright tests (see section 6). demos/: two MP3 demos.

Conventions / gotchas
- The AudioWorklet source is generated from class.toString() (ENGINE_CLASSES in app/core.js). Engine code must
  be classes with static methods; no module-level helpers in engine files. Add new engine classes to
  ENGINE_CLASSES, build.py, test/harness.js ORDER.
- build.py strips lines starting with "if (typeof module !== 'undefined')" -> keep each module.exports on ONE line.
- Messages to the engine: patch, set (path,v), on, off, cc, bend, at, tune, panic, pcmMap, pcmPack (zones,
  transferable buffer). Worklet posts {t:'st', v: voiceStates, need:[pack names]}.
- Program ids in the UI: st:N starter, us:N user, pm:N MOSS bank, pc:N PCM (bank*128+i), cb:N combination.
- Stored in browser localStorage: moss-user-programs, moss-current, moss-page, moss-perf, moss-kb (Keyboard page settings
  + learned MIDI next/prev buttons), moss-favs (favourite programs: list group + "|" + program text), moss-recent (the last 6
  programs played, 'bank:idx', newest first: Last buttons #lastbtn/#pblast/#mmlast and the browsers' 'Recently played' list;
  unsaved edits of a program left behind are kept in memory (recentEdits) and come back through them). Imported PCGs live in IndexedDB
  'trinity-web-synth', store 'files': {id, kind 'moss'|'tri', name, scale, fmt, rs, bytes} (raw bytes; restored
  asynchronously after start-up by restoreImported(); old localStorage keys moss-pcg / moss-tri are migrated).
  Max 8 imported files.
  moss-bank-edits: programs saved "in place" in a Trinity bank (Program page / MIDI mode "Save in place"): key
  'M|builtin|M or F|file|n' or 'P|builtin|A-D|file|n' -> patch. pcgPatch/pcmPatch and the bank name lists read it before the
  file's bytes, so combinations play the edit; "Restore original" deletes it; removing an imported file drops its edits.

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
  Multisample = ((b&0x7F)<<8)|next byte; 0x1000|n = RAM/Flash sample. (Drum mode: not supported.)
  Insert FX 4 x 22 B at 305; master FX 40 B at 393.
Drum kit (1426 B): see docs/research/03 (not used: drum kits were removed).
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

==============================================================================
4. CALIBRATION (estimates - verify against real hardware when possible)
==============================================================================
PCM cutoff: PCM.cutHz(x) = 250 * 2^(x/15.6) Hz, clamped 30 Hz..0.45*sr. Filter EG factor EGK = 2.
Filter input gain = value/99. Resonance 0..31 mapped onto MOSS resonance curve (x92/31).
LFO: 0.03 * 1000^(v/99) Hz. EG times: MD.tsec (shared with MOSS). PCM output trim 3.3.
Timbre level -> (level/127)^2; whole combination -3 dB. Voice caps in combis: PCM 32/(active timbres), MOSS 6.
Output: peak limiter (ceiling 0.89, 120 ms release) + soft clip.
UI: MOSS pages show "Trinity number · model estimate" (e.g. "40 · 250 ms"); pan shown Korg-style L000..C064..R127.

==============================================================================
5. CURRENT STATE AND OPEN ITEMS
==============================================================================
Done: MOSS models + effects; PCM engine; 111 stand-in packs; combinations; PCG import of
Bank M + PCM banks + combinations; Korg-number display; tests; IndexedDB storage; synth memory; Record button (WAV);
combination timbre Delay start (byte 243; key-off timbres released after 0.25 s, estimate) and MIDI filters
(byte 247 b1 damper, b2 aftertouch, b3 CC = rxDamper/rxAT/rxCC; b0 program change kept as rxPC, unused);
MOSS bend Step (byte 147: b0-3 +X, b4-7 -X, STEP list 0 cont, 1/8, 1/4, 1/2, 1..12 st = voice.bendStepUp/Down; PCM
programs' own STEP too) and Reed/Brass Jump Bend (rdJump/brJump bit0 +X, bit1 -X: bend in semitone jumps, 15 ms
move - interpretation; the OS labels it "Jump Bend:"). Multisample names = Trinity OS 3.1.1 wave-ROM directory.
Keyboard page (app/keyboard.js pageKeys, kbs): octaves / 1 or 2 rows / lowest key / key width+height / black key
length+width or hidden / note names / fixed touch velocity; computer keys start at the lowest on-screen C; Play mode (body.play: dock fills the screen, full screen + landscape lock where
allowed); MIDI next/prev program buttons (learn a note, CC or program change; program changes step or pick in bank);
SW1/SW2 lit by incoming CC80/81. Controls (kbs.ctl, Keyboard page 'Controls'): show/hide Oct, Trans, joystick, vertical X stick
(#xbar, bend), vertical Y stick (#ybar, +Y CC1 / -Y CC2), ribbon, SW buttons; sticks sit left of the keys and spring back; old playCtl migrated. Play bar: Sustain (CC64, shows the MIDI pedal), scale switch
(Equal / Arabic / maqams via loadMaqam / your scale; choosing turns program scales off), screen wake lock.
Program search (program.js progEntries/progList): filters the browsers and the ‹ › steps. Fonts bundled; PWA.
MIDI mode (app/midimode.js, body.midi, header button "MIDI mode"): no keys/editor; big program name, Prev/Next, Browse (search +
favourites; favOnly limits ‹ › too, reset on exit), scale/key, Oct/Trans, Sustain, Record, Panic, MIDI monitor (device, note,
bend, mod, voices), quick edit (mmMacros: MOSS/PCM Level, Cutoff, Resonance, Filter EG, Attack, Release moving both filters/oscillators
by the same delta; combis: level per playing timbre), Revert / Save (saveToUser) / Full editor. Arrow keys step, Esc exits.
Program browser (program.js progBrowser; used by the editor (#edbrowse under the display, opened by the bank button #progbtn
between ‹ ›; replaces the old program menu and search box), MIDI mode Browse and the play-mode list #pbl, opened by tapping the play-bar
name): one bank (list group) at a time, starting with the playing program's; the bank button lists all banks (after 'Recently played'); a search or the
favourites filter lists matches from every bank. Play bar ‹ › are 58x42 px.
Checks passed: all 2,560 PCM programs render (no NaN); 1,408 combinations render (no NaN, 1 silent by data);
MOSS sound identical to Version 11 (regress.js); browser tests in AudioWorklet and ScriptProcessor modes; phone width.

Open / ideas (not built):
1. Combination: per-timbre (program) scale not modelled.
2. Bank S (Solo-TRI board) not modelled; timbres pointing to S are silent.
3. RAM/Flash samples (0x1000|n) guessed by program name (PCM_RAMGUESS) - the audio only lived in the user's synth.
4. Timbre ifx rule inferred; calibration constants are estimates.
Decisions by the owner (do NOT propose these again):
- Never limit combinations to one MOSS program (the real Trinity's limit is deliberately not copied).
- Drum kits are removed and stay removed (no drum-sample list / kit fixes).
- No "export edits back to PCG" for now.
Synth memory (app/core.js memoryFor): an IMPORTED file uses its own PCM banks / Bank M first; what it lacks
comes from earlier imports (newest first), then the built-in files in list order (Hadi2024 first). Built-in files
only use their own data (unchanged behaviour). A file with a Bank S (imports: from the PCG; built-ins: "s":1 in
tridata.js, TRINI-1-KJ) never takes a Bank M: bank 4 = Solo-TRI there (silent). Timbres record t.from (source file
name, shown in the Timbres table) and t.src (lasting address = bankEdits key; stored combinations - User bank,
program kept over a reload - re-read their timbre programs by it: refreshTimbres). Combination-only and Bank-M-only
Trinity files are accepted (every Trinity import makes a tri set, so it has a place in the memory order).
Important fact: a PCG holds parameters only, never audio. Korg's ROM samples are on chips in the synth and
are not downloadable; the factory preload would also play stand-ins.

==============================================================================
6. BUILD, RUN, TEST
==============================================================================
Build:   python3 build.py [out.html] [--public]   (--public: without the owner's files - tridata.js and pcgdata.js.
         Netlify publishes the --public build; test/check_public.py checks it.)
Run:     python3 -m http.server 8765   then open http://localhost:8765/index.html (Chrome/Edge; needs http for audio,
         MIDI and samples). Web MIDI: Chrome, Edge, Firefox (not Safari).
Lint:    npm install once, then npm run lint (also in CI).
Tests: sh test/run_all.sh (~1 min, exit 0 = pass; FULL=1 for every program/combination, ~10 min).
  CI: .github/workflows/test.yml runs npm run lint, then build.py + run_all.sh on every push / PR.
  Checks: fxunit, fuzz, fxfix (effects), voicefix (notes), combifix (timbre delay, MIDI filters), progs (MOSS programs, every 8th), combis (every 16th,
  needs ffmpeg), browser_test.py (Playwright; starts its own server; sound in both audio modes, all pages, fx edit,
  phone width, recording, keyboard settings, play mode, search, MIDI buttons, IndexedDB storage, synth memory,
  error messages, public build: manifest, service worker, opens offline).
  test/harness.js loads sources in a vm; test/pcmpacks.js decodes samples/ with ffmpeg; test/mkpcg.js writes a PCG
  from built-in data. window.__moss exposes loadProgram(bank, idx), getPatch, noteOn/noteOff, selectPage, engine()
  (script mode), importPcgFile.
  test/tools/ (by hand, no pass/fail): regress.js / fxregress.js <older copy folder> (sample-by-sample regression;
  env STEP, SECS, ONLY), fxfunc.js, models2.js, fxprof.js, showfx.js.

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
- EXB-MOSS factory bank (Triton format, MOSS_EXT.PCG): https://www.korg.com/us/support/download/software/1/270/3183/
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
