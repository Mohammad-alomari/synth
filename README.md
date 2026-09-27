# Trinity Web Synth – a Korg Trinity V3 in the browser

A playable model of the Korg Trinity V3 that reads Trinity (and Triton) PCG files:

- **MOSS programs (Bank M)**: the DSP-MOSS-TRI board's 13 oscillator models (Standard, Comb, VPM, Resonance, Ring, Cross, Sync, Organ, E.Piano, Brass, Reed, Plucked, Bowed), filters, EGs, LFOs, modulation and the Trinity effects.
- **PCM programs (Banks A–D)**: Single, Double and Drum mode with the program's own filters, envelopes, LFOs and effects. Korg's sample ROM is not available, so each multisample is played by an openly licensed stand-in recording (General MIDI, MIT licence) or a built-in waveform.
- **Drum kits**: each Korg drum sample is played by the General MIDI drum sound that matches where Korg's factory kits place it.
- **Combinations**: 8 timbres with key/velocity zones, transpose, detune, bend range, level, pan, sends, the combination's insert-effect chains and master effects.

## Files

| File | What it is |
|---|---|
| `index.html` | The finished synth: one self-contained page, built from the files below. It loads the stand-in samples from `samples/`. |
| `ui.html` | Page template: layout and CSS. The sources are inserted at its `%%…%%` markers. |
| `app.js` | The user interface: pages, keyboard, joystick, MIDI, program list, PCG import, sample loader, save/load, audio start-up. |
| `engine.js` | The engine: MOSS oscillator models, filters, envelopes, LFOs, modulation, voice allocation, output limiter. |
| `pcm.js` | The PCM (ACCESS) voice: sample playback, filters, EGs, LFOs, drum kits, the stand-in sample store and built-in waveforms. |
| `combi.js` | Combinations: one engine per timbre, zones, timbre mix, insert chains and master effects. |
| `fxcat.js` | Catalogue of the Trinity effects: names, parameters and the byte layout in Korg programs. |
| `fxdsp.js` | The effect DSP (inserts, master effects, EQ) and the effect rack. |
| `patches.js` | The MOSS patch model, the default program and the starter programs (Mijwiz, Rababa, …). |
| `korg.js` | Reads Korg PCG files: MOSS, PCM programs, drum kits, combinations, effects, scales. |
| `pcmmap.js` | Which stand-in plays each Trinity multisample (0–374) and drum sample (0–258); Korg's multisample names. |
| `pcgdata.js` | Built-in MOSS banks as base64 (includes Korg's factory EXB-MOSS bank – keep this repository private). |
| `tridata.js` | Built-in Trinity PCG data (PCM banks, kits, combinations) from your own files. |
| `samples/` | The stand-in packs: one MP3 per General MIDI instrument or drum kit, plus `packs.json` (the maps). |
| `build.py` | Assembles `index.html` from `ui.html` and the `.js` files. |
| `gen_pcgdata.py` | Rebuilds the factory entry of `pcgdata.js` from a Triton Extreme PCG: `python3 gen_pcgdata.py <file.PCG>`. |
| `tools/samples/` | Rebuilds `samples/` from MuseScore's MS General SoundFont (`FluidR3Mono_GM.sf3`, MIT): `python3 tools/samples/build_packs.py` (set `SF3=` to the file). Needs ffmpeg. |
| `docs/research/` | Notes on the Trinity's data formats: program, combination, drum kit, global, PCG file, effects, multisample list. |
| `demos/` | Audio demos of the Mijwiz and Rababa starter programs. |
| `test/` | Offline tests (Node) and browser tests (Python + Playwright). |

## Run it

The page must be served over http (audio, MIDI and the samples need it):

```
python3 -m http.server 8765
```

Then open http://localhost:8765/index.html in Chrome or Edge. Web MIDI works in Chrome, Edge and Firefox; Safari has no Web MIDI.

## Change and rebuild

1. Edit the `.js` or `ui.html` files. Don't edit `index.html`: the build overwrites it.
2. Run `python3 build.py` to rebuild `index.html`.
3. Reload the page.

## Tests

Needs Node 18 or later (and ffmpeg for the PCM tests, which decode `samples/`).

Run all offline checks with `sh test/run_all.sh` (about 10 minutes). It also checks that `index.html` matches its sources, and exits non-zero if anything fails.

| Command | What it does |
|---|---|
| `node test/progs.js` | Renders every built-in MOSS program and reports NaN, levels and CPU. Add `VERBOSE=1` for one line per program. |
| `node test/combis.js [filter] [max]` | Plays every combination of the built-in files: NaN, silence, levels, CPU. |
| `node test/voicefix.js`, `node test/fxfix.js`, `node test/fuzz.js`, `node test/fxunit.js`, `node test/fxfunc.js` | Engine and effect checks. |
| `node test/models2.js` | Organ, E.Piano and Brass model checks. |
| `node test/fxregress.js <folder with an older copy>` | Compares every effect type against an older version. |
| `node test/fxprof.js`, `node test/showfx.js <ids>` | Tools: effect CPU profile; print a program's decoded effects. |
| `node test/regress.js <folder with an older copy of these files>` | Compares every MOSS program sample by sample against an older version. Env: `STEP`, `SECS`, `ONLY`, `DRY`, `SHOW`. |

The browser tests need Python with Playwright and `http.server` running on port 8765: `test/browser.py` (effects pages), `test/browser3.py` (Organ/E.Piano/Brass pages), `test/browser4.py` (MOSS), `test/browser5.py` (PCM programs), `test/browser6.py` (drum kits), `test/browser7.py` (combinations). Screenshots go to the system temp folder (set `SHOT=folder` for browser.py/browser3.py, or pass it as the argument for browser5-7).

## Licences and data

- Stand-in samples: MuseScore's MS General SoundFont (FluidR3 by Frank Wen, FluidR3Mono by Michael Cowgill, MS General by S. Christian Collins), MIT licence.
- `pcgdata.js` contains Korg's factory EXB-MOSS bank and `tridata.js` your own Trinity files: keep the repository private.
- Korg's Trinity factory preload is not included (its licence forbids redistribution). Download it from Korg and load it with **Import Trinity PCG**.
