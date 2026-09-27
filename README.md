# Trinity Web Synth – a Korg Trinity V3 in the browser

A playable model of the Korg Trinity V3 that reads Trinity (and Triton) PCG files:

- **MOSS programs (Bank M)**: the DSP-MOSS-TRI board's 13 oscillator models (Standard, Comb, VPM, Resonance, Ring, Cross, Sync, Organ, E.Piano, Brass, Reed, Plucked, Bowed), filters, EGs, LFOs, modulation and the Trinity effects.
- **PCM programs (Banks A–D)**: Single and Double mode with the program's own filters, envelopes, LFOs and effects. Korg's sample ROM is not available, so each multisample is played by an openly licensed stand-in recording (General MIDI, MIT licence) or a built-in waveform.
- **Drum kits** are not supported: Drum-mode programs are left out, and combination timbres that use one stay silent.
- **Combinations**: 8 timbres with key/velocity zones, transpose, detune, bend range, level, pan, sends, the combination's insert-effect chains and master effects.
- **Record**: the Record button saves what you play (after the effects) as a stereo WAV file.

## Files

| File | What it is |
|---|---|
| `index.html` | The finished synth: one self-contained page, built from the files below by `python3 build.py` (not committed). It loads the stand-in samples from `samples/`. |
| `ui.html` | Page template: layout and CSS. The sources are inserted at its `%%…%%` markers. |
| `app.js` | The user interface: pages, keyboard, joystick, MIDI, program list, PCG import, sample loader, save/load, audio start-up. |
| `engine.js` | The engine: MOSS oscillator models, filters, envelopes, LFOs, modulation, voice allocation, output limiter. |
| `pcm.js` | The PCM (ACCESS) voice: sample playback, filters, EGs, LFOs, the stand-in sample store and built-in waveforms. |
| `combi.js` | Combinations: one engine per timbre, zones, timbre mix, insert chains and master effects. |
| `fxcat.js` | Catalogue of the Trinity effects: names, parameters and the byte layout in Korg programs. |
| `fxdsp.js` | The effect DSP (inserts, master effects, EQ) and the effect rack. |
| `patches.js` | The MOSS patch model, the default program and the starter programs (Mijwiz, Rababa, …). |
| `korg.js` | Reads Korg PCG files: MOSS, PCM programs, combinations, effects, scales. |
| `pcmmap.js` | Which stand-in plays each Trinity multisample (0–374); Korg's multisample names. |
| `pcgdata.js` | Built-in MOSS banks as base64 (includes Korg's factory EXB-MOSS bank – keep this repository private). |
| `tridata.js` | Built-in Trinity PCG data (PCM banks, combinations) from your own files. |
| `samples/` | The stand-in packs: one MP3 per General MIDI instrument or drum set (used by percussion multisamples), plus `packs.json` (the maps). |
| `build.py` | Assembles `index.html` from `ui.html` and the `.js` files. |
| `gen_pcgdata.py` | Rebuilds the factory entry of `pcgdata.js` from a Triton Extreme PCG: `python3 gen_pcgdata.py <file.PCG>`. |
| `tools/samples/` | Rebuilds `samples/` from MuseScore's MS General SoundFont (`FluidR3Mono_GM.sf3`, MIT): `python3 tools/samples/build_packs.py` (set `SF3=` to the file). Needs ffmpeg. |
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

`netlify.toml` tells Netlify to run `python3 build.py dist/index.html --public` on every push and publish only `index.html` + `samples/`. The public build leaves out your own PCG files (`tridata.js` and your Bank M banks); visitors import their own files. `python3 build.py` without `--public` builds the full page with your files, for use on your own computer. Connect the GitHub repo in Netlify once (Add new site → Import an existing project); after that every push to `main` deploys, and every pull request gets a preview.

## Change and rebuild

1. Edit the `.js` or `ui.html` files. Don't edit `index.html`: the build overwrites it.
2. Run `python3 build.py` to rebuild `index.html`.
3. Reload the page.

## Tests

`sh test/run_all.sh` runs every check in about a minute and exits non-zero if anything fails. GitHub Actions runs it on every push and pull request (`.github/workflows/test.yml`); a red cross on the commit means a check failed or the build broke. `FULL=1 sh test/run_all.sh` renders every program and combination instead of a sample (about 10 minutes).

Needs Node 18+, python3, ffmpeg (for `combis.js`) and, for the browser test, `pip install playwright` + `python3 -m playwright install chromium`.

| Check | What it does |
|---|---|
| `python3 build.py` | The page builds from the sources. |
| `node test/fxunit.js`, `node test/fuzz.js`, `node test/fxfix.js` | Every effect: no NaN, bounded output with random parameters, fixed bugs stay fixed. |
| `node test/voicefix.js` | Note handling: sustain, Hold, voice stealing, portamento, MIDI sync. |
| `node test/progs.js` | Renders built-in MOSS programs (every 8th; `FULL=1` all): NaN, levels, CPU. |
| `node test/combis.js` | Plays built-in combinations (every 16th; `FULL=1` all). |
| `python3 test/browser_test.py` | The built page in Chromium: sound in both audio modes, every page, effects editing, phone width, imported-PCG storage, synth memory, error messages. |

Tools (no pass/fail, run by hand) are in `test/tools/`: `regress.js` / `fxregress.js <folder with an older copy>` compare every MOSS program / effect sample by sample, `fxfunc.js` and `models2.js` measure effects and models, `fxprof.js` profiles effect CPU, `showfx.js <ids>` prints a program's decoded effects. `node test/mkpcg.js <built-in name> <out.pcg> [pcm,combi,kit,moss]` writes a PCG file for import tests.

## Licences and data

- Stand-in samples: MuseScore's MS General SoundFont (FluidR3 by Frank Wen, FluidR3Mono by Michael Cowgill, MS General by S. Christian Collins), MIT licence.
- `pcgdata.js` contains Korg's factory EXB-MOSS bank and `tridata.js` your own Trinity files: keep the repository private.
- Korg's Trinity factory preload is not included (its licence forbids redistribution). Download it from Korg and load it with **Import Trinity PCG**.
