#!/usr/bin/env python3
"""Download per-note recordings and decode them to 32-bit float WAV (native rate, stereo kept).

Sources (all fetched from GitHub raw or the npm registry, which are reachable from the build shell):

  gleitz:<Soundfont>/<instrument>   e.g. gleitz:FluidR3_GM/string_ensemble_1
      https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/<Soundfont>/<instrument>-mp3/<Note>.mp3
      Note names use flats: C Db D Eb E F Gb G Ab A Bb B, octave per MIDI (C4 = 60), A0..C8.
  salamander:v<N>                   e.g. salamander:v8   (N = 1..16 velocity layer)
      npm tarball @audio-samples/piano-mp3-velocity<N> -> audio/<Note>v<N>.mp3, notes A,C,D#,F# (minor thirds)

Usage:
  python3 fetch_notes.py gleitz:FluidR3_GM/string_ensemble_1 --lo 33 --hi 96 --step 3 --out decoded/strings_fluid
  python3 fetch_notes.py salamander:v8 --lo 21 --hi 108 --step 3 --out decoded/piano_salamander

Writes <out>/<midi>.wav (float32, native rate) and <out>/source.json (URLs, licence, formats).
"""
import argparse
import io
import json
import os
import subprocess
import sys
import tarfile
import urllib.request

import numpy as np
import soundfile as sf

FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
GLEITZ_RAW = 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages'
LICENCES = {
    'FluidR3_GM': 'CC-BY 3.0 per gleitz README (rendered from FluidR3_GM.sf2, which Frank Wen released under MIT)',
    'MusyngKite': 'CC-BY-SA 3.0 per gleitz README (source soundfont provenance unclear - avoid)',
    'FatBoy': 'CC-BY-SA 3.0 per gleitz README',
    'salamander': 'CC-BY 3.0, Salamander Grand Piano V3 by Alexander Holm (npm wrapper MIT, Jan Forst)',
}


def note_name(m, names):
    return f"{names[m % 12]}{m // 12 - 1}"


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def decode(data):
    """Decode mp3/ogg/wav bytes -> (float32 [frames, ch], rate). libsndfile handles mp3 (>=1.1); ffmpeg fallback."""
    try:
        x, sr = sf.read(io.BytesIO(data), dtype='float32', always_2d=True)
        return x, sr
    except Exception:
        p = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-'], input=data,
                           capture_output=True, check=True)
        info = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=sample_rate,channels',
                               '-of', 'csv=p=0', '-i', 'pipe:0'], input=data, capture_output=True, text=True).stdout
        sr, ch = [int(v) for v in info.strip().split(',')[:2]]
        return np.frombuffer(p.stdout, dtype='<f4').reshape(-1, ch), sr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('--lo', type=int, default=21)
    ap.add_argument('--hi', type=int, default=108)
    ap.add_argument('--step', type=int, default=3)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    meta = dict(source=a.source, notes={})
    kind, _, ref = a.source.partition(':')
    tar = None
    if kind == 'salamander':
        v = ref.lstrip('v')
        url = f'https://registry.npmjs.org/@audio-samples/piano-mp3-velocity{v}/-/piano-mp3-velocity{v}-1.0.5.tgz'
        tar = tarfile.open(fileobj=io.BytesIO(fetch(url)))
        meta['url_pattern'] = url + ' :: package/audio/<Note>v' + v + '.mp3'
        meta['licence'] = LICENCES['salamander']
    elif kind == 'gleitz':
        sfname, inst = ref.split('/')
        meta['url_pattern'] = f'{GLEITZ_RAW}/{sfname}/{inst}-mp3/<Note>.mp3'
        meta['licence'] = LICENCES.get(sfname, '?')
    for m in range(a.lo, a.hi + 1, a.step):
        try:
            if kind == 'gleitz':
                url = f'{GLEITZ_RAW}/{sfname}/{inst}-mp3/{note_name(m, FLAT)}.mp3'
                data = fetch(url)
            else:
                name = f'package/audio/{note_name(m, SHARP)}v{v}.mp3'
                url = name
                data = tar.extractfile(name).read()
        except Exception as e:
            print('skip', m, e, file=sys.stderr)
            continue
        x, sr = decode(data)
        sf.write(os.path.join(a.out, f'{m}.wav'), x, sr, subtype='FLOAT')
        meta['notes'][m] = dict(url=url, bytes=len(data), rate=sr, channels=x.shape[1], seconds=round(len(x) / sr, 3))
        print(m, note_name(m, SHARP), len(data), 'bytes', sr, 'Hz', x.shape[1], 'ch', round(len(x) / sr, 2), 's')
    with open(os.path.join(a.out, 'source.json'), 'w') as f:
        json.dump(meta, f, indent=1)


if __name__ == '__main__':
    main()
