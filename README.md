# Trinity Web Synth – a Korg Trinity V3 in the browser

A playable model of the Korg Trinity V3 that reads Trinity (and Triton) PCG files:

- **MOSS programs (Bank M)**: the DSP-MOSS-TRI board's 13 oscillator models (Standard, Comb, VPM, Resonance, Ring, Cross, Sync, Organ, E.Piano, Brass, Reed, Plucked, Bowed), filters, EGs, LFOs, modulation and the Trinity effects.
- **PCM programs (Banks A–D)**: Single and Double mode with the program's own filters, envelopes, LFOs and effects. Korg's sample ROM is not available, so each multisample is played by an openly licensed stand-in recording (General MIDI, MIT licence) or a built-in waveform. Triton PCM programs are read too (bank F holds a Triton file's MOSS bank).
- **Drum kits** are not supported: Drum-mode programs are left out, and combination timbres that use one stay silent.
- **Combinations**: 8 timbres with key/velocity zones, transpose, detune, bend range, level, pan, sends, delay start, MIDI filters (damper, aftertouch, controllers), the combination's insert-effect chains and master effects.
- **Programs**: a program browser (one bank at a time, search, ★ favourites, recently played), a **Last** button that goes back to the previous program, **New program** (a blank MOSS, PCM or combination program), **Save in place** (combinations then play the edited program) and **Save to User**.
- **MIDI mode**: for playing from a MIDI keyboard: big program name, program change, scale, a MIDI monitor and quick sound controls, no on-screen keys.
- **Record**: the Record button saves what you play (after the effects) as a stereo WAV file.
- **Play mode**: a full-screen keyboard for a phone held sideways, with joystick, ribbon, SW1/SW2, a Sustain button and a quick scale / maqam switch. The screen stays on while you play.
- **Keyboard page**: number of octaves, one or two rows, lowest key, key width and height, black keys normal / small / very small / hidden, note names, touch velocity; MIDI buttons for next / previous program (learned, or the keyboard's program changes).
- **Install as an app**: Chrome and Edge offer **Install app** (on an iPhone: Share → Add to Home Screen). The installed synth opens full screen and plays offline with the sample packs it has used.
- **Light on the CPU when idle**: an effect whose input and output have been silent for 6 s rests until sound comes in again.

## Files

| File | What it is |
|---|---|
| `index.html` | The finished synth: one self-contained page, built from the files below by `python3 build.py` (not committed). It loads the stand-in samples from `samples/`. |
| `ui.html` | Page template: layout and CSS. The sources are inserted at its `%%…%%` markers. |
| `app/` | The user interface, in the order `build.py` joins them (they share one scope): `core.js` (storage, PCG banks, audio start-up, sample loader), `pages.js` (editor pages), `program.js` (program browser, LCD, signal flow), `scale.js` (scales, maqams), `keyboard.js` (on-screen keyboard, Keyboard page, joystick, play mode), `record.js`, `midi.js`, `midimode.js` (MIDI mode), `boot.js`. |
| `engine.js` | The engine: MOSS oscillator models, filters, envelopes, LFOs, modulation, voice allocation, output limiter. |
| `pcm.js` | The PCM (ACCESS) voice: sample playback, filters, EGs, LFOs, the stand-in sample store and built-in waveforms. |
| `combi.js` | Combinations: one engine per timbre, zones, timbre mix, insert chains and master effects. |
| `fxcat.js` | Catalogue of the Trinity effects: names, parameters and the byte layout in Korg programs. |
| `fxdsp.js` | The effect DSP (inserts, master effects, EQ) and the effect rack. |
| `patches.js` | The MOSS patch model, the default program and the starter programs (Mijwiz, Rababa, …). |
| `korg.js` | Reads Korg PCG files: MOSS, PCM programs (Trinity and Triton), combinations, effects, scales. |
| `pcmmap.js` | Which stand-in plays each Trinity multisample (0–374); Korg's multisample names; which Korg recordings replace stand-ins in the owner's copy. |
| `pcgdata.js` | Built-in MOSS banks (Bank M) of your own files, as base64. |
| `tridata.js` | Built-in Trinity PCG data (PCM banks, combinations) from your own files. |
| `userdata.js` | Starter programs from your own Triton sample disk (made by `tools/user_starters.js`). |
| `samples/` | The stand-in packs: one MP3 per General MIDI instrument or drum set (used by percussion multisamples), plus `packs.json` (the maps). `samples/korg/` and `samples/user/` (Korg's recordings and your own sample disks, built on your computer) are never committed. |
| `build.py` | Assembles `index.html` from `ui.html`, the `.js` files and the fonts. |
| `fonts/` | The web fonts (Barlow, Barlow Condensed, VT323; SIL Open Font License), inlined into the page so it needs no font server. |
| `manifest.webmanifest`, `sw.js`, `icons/` | The installable app: manifest, service worker (offline use) and icons (`python3 tools/make_icons.py` redraws them; needs Pillow). |
| `package.json`, `eslint.config.js` | `npm run lint` (ESLint), `npm run build`, `npm test`, `npm run dev` (build and serve on port 8765). |
| `netlify.toml` | The public site's build (see Deploy). |
| `tools/samples/` | Rebuilds `samples/` from MuseScore's MS General SoundFont (`FluidR3Mono_GM.sf3`, MIT): `python3 tools/samples/build_packs.py` (set `SF3=` to the file). Needs ffmpeg. `build_korg.py` turns Korg KMP/KSF multisamples (your PBS-TRI libraries or sample disks) into packs with ConvertWithMoss in a Docker image (`tools/samples/korg/`). |
| `tools/user_starters.js` | Writes `userdata.js` from a Triton PCG and its sample disk. |
| `docs/research/` | Notes on the Trinity's data formats: program, combination, drum kit, global, PCG file, effects, multisample list. |
| `demos/` | Audio demos (MP3) of the Mijwiz and Rababa starter programs. |
| `test/` | Offline tests (Node) and browser tests (Python + Playwright). |

## Run it

The page must be served over http (audio, MIDI and the samples need it):

```
python3 -m http.server 8765
```

Build the page first with `python3 build.py`, then open http://localhost:8765/index.html in Chrome or Edge. Web MIDI works in Chrome, Edge and Firefox; Safari has no Web MIDI.

## Deploy (Netlify)

`netlify.toml` tells Netlify to run `python3 build.py dist/index.html --public` on every push and publish only `index.html`, `samples/` and the app files (`manifest.webmanifest`, `sw.js`, `icons/`). The public build leaves out your own files (`tridata.js`, `pcgdata.js`, `userdata.js`) and never includes `samples/korg/` or `samples/user/`; visitors import their own files. `python3 build.py` without `--public` builds the full page with your files, for use on your own computer. Connect the GitHub repo in Netlify once (Add new site → Import an existing project); after that every push to `main` deploys, and every pull request gets a preview.

## Change and rebuild

1. Edit the `.js` or `ui.html` files. Don't edit `index.html`: the build overwrites it.
2. Run `python3 build.py` to rebuild `index.html` (or `npm run dev` to build and serve it).
3. Reload the page.
4. `npm run lint` checks the code (run `npm install` once first); CI runs it too.

## Tests

`sh test/run_all.sh` runs every check in about two minutes and exits non-zero if anything fails. GitHub Actions runs it on every push and pull request (`.github/workflows/test.yml`); a red cross on the commit means a check failed or the build broke. `FULL=1 sh test/run_all.sh` renders every program and combination instead of a sample.

Needs Node 18+, python3, ffmpeg (for `combis.js`) and, for the browser test, `pip install playwright` + `python3 -m playwright install chromium`.

| Check | What it does |
|---|---|
| `python3 build.py`, `python3 test/check_public.py` | The page builds from the sources; the public build has none of your files. |
| `node test/fxunit.js`, `node test/fuzz.js`, `node test/fxfix.js` | Every effect: no NaN, bounded output with random parameters, fixed bugs stay fixed, effects rest only after their last echo. |
| `node test/voicefix.js` | Note handling: sustain, Hold, voice stealing, portamento, MIDI sync. |
| `node test/combifix.js` | Combinations: timbre delay start and MIDI filters. |
| `node test/progs.js` | Renders built-in MOSS programs (every 8th; `FULL=1` all): NaN, levels, CPU. |
| `node test/combis.js` | Plays built-in combinations (every 16th; `FULL=1` all). |
| `python3 test/browser_test.py` | The built page in Chromium: sound in both audio modes, every page, effects editing, phone width, recording (both recorders), keyboard settings, play mode, program browser, MIDI program buttons, imported-PCG storage, synth memory, error messages, and the public build as an installable app that opens offline. |

The Node tests load the sources through `test/harness.js`, in one scope as the page does.

Tools (no pass/fail, run by hand) are in `test/tools/`: `regress.js <folder with an older copy>` renders MOSS programs, PCM programs and combinations with both copies and compares them sample by sample (a copy of the last commit: `git archive HEAD | tar -x -C <folder>`); `fxregress.js` does the same for every effect; `fxfunc.js` and `models2.js` measure effects and models, `fxprof.js` profiles effect CPU, `showfx.js <ids>` prints a program's decoded effects. `node test/mkpcg.js <built-in name> <out.pcg> [pcm,combi,moss]` writes a PCG file for import tests.

## Licences and data

- Stand-in samples: MuseScore's MS General SoundFont (FluidR3 by Frank Wen, FluidR3Mono by Michael Cowgill, MS General by S. Christian Collins), MIT licence.
- `pcgdata.js`, `tridata.js` and `userdata.js` contain your own files: keep the repository private.
- Korg's recordings (`samples/korg/`) and your sample disks (`samples/user/`) stay on your computer: they are never committed or published. ConvertWithMoss (LGPL-3.0) is only run as a tool in Docker; it is not part of the page.
- Korg's factory EXB-MOSS bank is not included. Download "EXB-MOSS – MOSS Factory Preload Data" from Korg (https://www.korg.com/us/support/download/software/1/270/3183/), unzip it and load `MOSS_EXT.PCG` with **Import Trinity PCG** (Triton-family PCG files are read too; their MOSS bank shows as bank F).
- Korg's Trinity factory preload is not included (its licence forbids redistribution). Download it from Korg and load it with **Import Trinity PCG**.
