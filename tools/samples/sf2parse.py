#!/usr/bin/env python3
"""Minimal SoundFont 2 / SF3 parser.

Reads an .sf2 (16-bit PCM) or MuseScore/FluidSynth .sf3 (Ogg Vorbis per sample)
file and exposes presets -> instrument zones -> sample headers, which is the same
hierarchy as a ROM PCM synth (program -> multisample -> sample + loop).

Usage as a script:
    python3 sf2parse.py FILE.sf2              # list presets
    python3 sf2parse.py FILE.sf2 BANK PROG    # dump resolved zones for one preset as JSON

Library:
    sf = SoundFont(path)
    zones = sf.preset_zones(bank, prog)   # list of dicts (key range, vel range, sample, root, loop...)
    pcm, rate = sf.decode_sample(sample_index)  # float32 mono numpy array
"""
import io
import json
import struct
import sys

import numpy as np

GEN_NAMES = {
    0: 'startAddrsOffset', 1: 'endAddrsOffset', 2: 'startloopAddrsOffset', 3: 'endloopAddrsOffset',
    4: 'startAddrsCoarseOffset', 5: 'modLfoToPitch', 6: 'vibLfoToPitch', 7: 'modEnvToPitch',
    8: 'initialFilterFc', 9: 'initialFilterQ', 10: 'modLfoToFilterFc', 11: 'modEnvToFilterFc',
    12: 'endAddrsCoarseOffset', 13: 'modLfoToVolume', 15: 'chorusEffectsSend', 16: 'reverbEffectsSend',
    17: 'pan', 21: 'delayModLFO', 22: 'freqModLFO', 23: 'delayVibLFO', 24: 'freqVibLFO',
    25: 'delayModEnv', 26: 'attackModEnv', 27: 'holdModEnv', 28: 'decayModEnv', 29: 'sustainModEnv',
    30: 'releaseModEnv', 31: 'keynumToModEnvHold', 32: 'keynumToModEnvDecay', 33: 'delayVolEnv',
    34: 'attackVolEnv', 35: 'holdVolEnv', 36: 'decayVolEnv', 37: 'sustainVolEnv', 38: 'releaseVolEnv',
    39: 'keynumToVolEnvHold', 40: 'keynumToVolEnvDecay', 41: 'instrument', 43: 'keyRange', 44: 'velRange',
    45: 'startloopAddrsCoarseOffset', 46: 'keynum', 47: 'velocity', 48: 'initialAttenuation',
    50: 'endloopAddrsCoarseOffset', 51: 'coarseTune', 52: 'fineTune', 53: 'sampleID', 54: 'sampleModes',
    56: 'scaleTuning', 57: 'exclusiveClass', 58: 'overridingRootKey',
}
RANGE_GENS = (43, 44)
SIGNED_GENS = {0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28,
               29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 45, 48, 50, 51, 52, 56, 57, 58}


def _chunks(buf, off, end):
    while off + 8 <= end:
        cid = buf[off:off + 4].decode('latin1')
        size = struct.unpack_from('<I', buf, off + 4)[0]
        yield cid, off + 8, size
        off += 8 + size + (size & 1)


class SoundFont:
    def __init__(self, path):
        with open(path, 'rb') as f:
            self.buf = buf = f.read()
        assert buf[0:4] == b'RIFF' and buf[8:12] == b'sfbk', 'not a SoundFont'
        self.info = {}
        self.smpl_off = self.smpl_size = None
        pdta = {}
        for cid, off, size in _chunks(buf, 12, len(buf)):
            if cid != 'LIST':
                continue
            ltype = buf[off:off + 4].decode('latin1')
            for sid, soff, ssize in _chunks(buf, off + 4, off + size):
                if ltype == 'INFO':
                    if sid == 'ifil':
                        self.info[sid] = struct.unpack_from('<HH', buf, soff)
                    else:
                        self.info[sid] = buf[soff:soff + ssize].split(b'\0')[0].decode('latin1', 'replace')
                elif ltype == 'sdta' and sid == 'smpl':
                    self.smpl_off, self.smpl_size = soff, ssize
                elif ltype == 'pdta':
                    pdta[sid] = (soff, ssize)
        self.version = self.info.get('ifil', (2, 1))
        self.is_sf3 = self.version[0] >= 3
        self._parse_pdta(pdta)

    def _parse_pdta(self, pdta):
        b = self.buf

        def recs(name, fmt):
            off, size = pdta[name]
            n = struct.calcsize(fmt)
            return [struct.unpack_from(fmt, b, off + i * n) for i in range(size // n)]

        self.phdr = [(r[0].split(b'\0')[0].decode('latin1'), r[1], r[2], r[3]) for r in recs('phdr', '<20sHHHIII')]
        self.pbag = recs('pbag', '<HH')
        self.pgen = recs('pgen', '<HH')
        self.inst = [(r[0].split(b'\0')[0].decode('latin1'), r[1]) for r in recs('inst', '<20sH')]
        self.ibag = recs('ibag', '<HH')
        self.igen = recs('igen', '<HH')
        self.shdr = []
        for r in recs('shdr', '<20sIIIIIBbHH'):
            self.shdr.append(dict(name=r[0].split(b'\0')[0].decode('latin1'), start=r[1], end=r[2],
                                  loopStart=r[3], loopEnd=r[4], rate=r[5], origPitch=r[6],
                                  pitchCorr=r[7], link=r[8], type=r[9]))

    @staticmethod
    def _gen_value(oper, amount):
        if oper in RANGE_GENS:
            return (amount & 0xFF, amount >> 8)
        if oper in SIGNED_GENS and amount >= 0x8000:
            return amount - 0x10000
        return amount

    def _zones(self, bags, gens, first, last):
        zones = []
        for bi in range(first, last):
            g0, g1 = bags[bi][0], bags[bi + 1][0]
            z = {}
            for oper, amt in gens[g0:g1]:
                z[oper] = self._gen_value(oper, amt)
            zones.append(z)
        return zones

    def presets(self):
        out = []
        for i, (name, prog, bank, bag, *_rest) in enumerate(self.phdr[:-1]):
            out.append(dict(index=i, name=name, bank=bank, program=prog))
        return out

    def preset_zones(self, bank, prog):
        """Flatten preset+instrument zones into playable regions (SF2 spec 9.4 semantics, simplified:
        preset-level generators are additive offsets; ranges are intersected)."""
        pi = next(i for i, p in enumerate(self.phdr[:-1]) if p[1] == prog and p[2] == bank)
        pzones = self._zones(self.pbag, self.pgen, self.phdr[pi][3], self.phdr[pi + 1][3])
        pglobal = {}
        if pzones and 41 not in pzones[0]:
            pglobal = pzones.pop(0)
        regions = []
        for pz in pzones:
            if 41 not in pz:
                continue
            p = dict(pglobal); p.update(pz)
            ii = p[41]
            izones = self._zones(self.ibag, self.igen, self.inst[ii][1], self.inst[ii + 1][1])
            iglobal = {}
            if izones and 53 not in izones[0]:
                iglobal = izones.pop(0)
            for iz in izones:
                if 53 not in iz:
                    continue
                z = dict(iglobal); z.update(iz)
                kr = _intersect(z.get(43, (0, 127)), p.get(43, (0, 127)))
                vr = _intersect(z.get(44, (0, 127)), p.get(44, (0, 127)))
                if kr is None or vr is None:
                    continue
                gens = {}
                for k, v in z.items():
                    if k not in (43, 44, 53):
                        gens[k] = v
                for k, v in p.items():  # preset-level: additive
                    if k in (41, 43, 44):
                        continue
                    gens[k] = gens.get(k, 0) + v
                s = self.shdr[z[53]]
                root = gens.get(58, -1)
                if root is None or root < 0:
                    root = s['origPitch']
                regions.append(dict(
                    instrument=self.inst[ii][0], keyRange=kr, velRange=vr, sampleIndex=z[53],
                    sampleName=s['name'], rate=s['rate'], rootKey=root,
                    tuneCents=gens.get(51, 0) * 100 + gens.get(52, 0) - s['pitchCorr'],
                    sampleModes=gens.get(54, 0) & 3, pan=gens.get(17, 0),
                    attenuation_cB=gens.get(48, 0), exclusiveClass=gens.get(57, 0),
                    gens={GEN_NAMES.get(k, str(k)): v for k, v in sorted(gens.items())},
                ))
        return regions

    def sample_loop(self, si):
        """Loop points in frames relative to sample start (works for SF2 and SF3)."""
        s = self.shdr[si]
        if self.is_sf3 and (s['type'] & 0x10):
            return s['loopStart'], s['loopEnd']  # SF3: already relative to decoded sample start
        return s['loopStart'] - s['start'], s['loopEnd'] - s['start']

    def decode_sample(self, si):
        s = self.shdr[si]
        if self.is_sf3 and (s['type'] & 0x10):
            import soundfile as sf
            data = self.buf[self.smpl_off + s['start']:self.smpl_off + s['end']]
            pcm, rate = sf.read(io.BytesIO(data), dtype='float32', always_2d=True)
            return pcm[:, 0].copy(), s['rate']
        a = np.frombuffer(self.buf, dtype='<i2', count=s['end'] - s['start'],
                          offset=self.smpl_off + 2 * s['start'])
        return a.astype(np.float32) / 32768.0, s['rate']


def _intersect(a, b):
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    return (lo, hi) if lo <= hi else None


if __name__ == '__main__':
    sf = SoundFont(sys.argv[1])
    if len(sys.argv) == 2:
        print(json.dumps({k: v for k, v in sf.info.items()}, indent=1))
        for p in sorted(sf.presets(), key=lambda p: (p['bank'], p['program'])):
            print(f"{p['bank']:3d}:{p['program']:3d}  {p['name']}")
    else:
        regs = sf.preset_zones(int(sys.argv[2]), int(sys.argv[3]))
        for r in regs:
            r['loop'] = sf.sample_loop(r['sampleIndex'])
            r['frames'] = None
        print(json.dumps(regs, indent=1))
