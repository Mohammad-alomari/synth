KORG TRINITY PCG / SYSEX RESEARCH - INDEX, SOURCES, CAVEATS   (2026-09-26)
=========================================================================

FILES
  01_pcm_program_433.txt      PCM/ACCESS program map, all 433 bytes + enumerations    (Korg, verified on PCGs)
  02_combination_388.txt      Combination map, 388 bytes, 8 timbres x 19               (Korg scan, verified)
  03_drumkit_1426.txt         Drum kit map, 18 + 88 keys x 16                          (Korg scan, verified)
  04_global.txt               Global SysEx map (1172) + how the PCG global (1175) differs (partly inferred)
  05_pcg_file_format.txt      PCG header/directory/sections/bank headers, PCG Tools field notes
  06_effects.txt              Insert (22 B) / master (40 B) effect block layout + effect type lists
  07_multisamples_trinity_0-374_trrack_375-414.tsv   multisample index -> name (Trinity 0-374, TR-Rack 375-414)
  08_factory_programs_ABCD_trrack.tsv   TR-Rack factory program names A-D (A/B = Trinity factory A/B)
  09_factory_combis_ABCD_trrack.tsv     TR-Rack factory combination names A-D (A/B = Trinity factory A/B)
  src_TR-Rack_MIDI-implementation_pdftotext.txt   Korg TR-Rack MIDI implementation (sections 1-3 + TABLE1 only)
  scans/p173..p191_*.png      Korg Trinity Parameter Guide MIDI-implementation pages (rotated upright), incl.
                              TABLE1 prog, TABLE2 SOLO (S-bank, 521 B, not transcribed), TABLE3 combi,
                              TABLE4 global, TABLE5/6 play-mode params, TABLE7 drumkit, TABLE8 song/sequence
  code_pcgtools_trinity/      PCG Tools Trinity-specific C# sources + author's notes
  code_other/trinity_pcg_dump.py   reference decoder using these maps (run: python3 trinity_pcg_dump.py X.PCG)
  code_other/pcgdir.py, Toluene_ParameterIDs.h, TR-Rack-Editor_panel_lists.json (raw arrays from the Ctrlr panel)

SOURCES (URLs)
  * Korg Trinity Parameter Guide incl. MIDI Implementation (scanned MIDI pages, 1995, Trinity V1):
      https://github.com/dave-billin/Toluene  -> doc/KorgTrinity-ParameterGuideWithMIDIImplementation.pdf (p.173-191)
      (Korg's own copy: https://www.korg.com/us/support/download/manual/1/213/1708/ -> TRINITY_ParamG_E5.pdf;
       MIDI pages are images there too; Korg forum thread complains they are hard to read.)
  * Korg TR-Rack MIDI Implementation (text, 1997; only sections 1-3 + TABLE1, TABLE2-7 missing from file):
      https://www.korg.com/us/support/download/manual/1/212/2728/  (TR_RACK_MIDIimp.txt)
      also doc/TR-Rack_MIDI-implementation.pdf in the Toluene repo.
  * Korg "TRINITY Effects MIDI System Exclusive" (per-effect parameter tables, machine-readable, NOT fetched):
      https://www.korg.com/us/support/download/manual/1/213/3298/  (Trinity_FX.pdf)
  * Korg Voice Name Lists (scanned, contain multisample/drumsample/program lists; could not be OCR'd here):
      Trinity: https://www.korg.com/us/support/download/manual/1/213/1704/  (TRINITY_VoiceName.pdf, 1.9 MB)
      Trinity V3: https://www.korg.com/us/support/download/manual/1/213/1703/ (TRINITY_VoiceV3.pdf)
      TR-Rack: https://www.korg.com/us/support/download/manual/1/212/1699/  (TRRack_VoiceName.pdf)
  * PCG Tools (Michel Keijzers), GitHub copy: https://github.com/DaBlick/PCG-Tools
      (KorgKronosTools/Model/TrinitySpecific/*; supports Trinity V2/V3, S and M banks)
  * Toluene - JUCE SysEx editor for Trinity/TR-Rack (Dave Billin): https://github.com/dave-billin/Toluene
      (ParameterIDs.h: parameter IDs incl. effect type enums; docs folder with all Korg manuals)
  * TR-Rack Ctrlr editor panel (Tom Harper): https://github.com/FRDTom/TR-Rack-Editor
      ("Tr Rack Editor.bpanelz" = zlib; contains program/combi/multisample/effect name arrays + SysEx decoder)
  * Other repos checked, not Trinity: OlimilO1402/KORG_Read_pcg (Triton-family PCG incl. 2006 "TR"),
      burningalchemist/pcg2syx (N364/X3/01W), christofmuc/KnobKraft-orm (no Trinity adaptation).

STATUS OF THE 3 ASKS
  1. Main MIDI implementation: FOUND (Korg scans + TR-Rack text). Program (433), Combination (388),
     Drum kit (1426), Global (1172 SysEx) tables transcribed and verified on the user's PCG files.
     Effect block layout found (in the SONG table); per-effect 16-byte parameter meanings NOT transcribed.
  2. ROM lists: multisample list 0..414 FOUND (hand-typed list in the TR-Rack Ctrlr panel; 0..374 = Trinity);
     factory program + combination names A-D FOUND (TR-Rack; A/B = Trinity factory, confirmed against the
     user's file). DRUM-SAMPLE NAME LIST and DRUM-KIT factory names list: NOT FOUND in machine-readable form
     (only in Korg's scanned Voice Name List). Factory kit names seen in user file: Standard Kit, Processed Kit,
     Jazz/Brush Kits, ..., "01/W Producer's" (12 kits).
  3. Open-source code: PCG Tools (C#) extracted; Toluene (C++) and TR-Rack Ctrlr panel (Lua) also useful.

CAVEATS
  * Korg tables are Trinity V1 (Aug/Dec 1995). Sizes match all later models' PCGs (433/388/1426), so the layout
    did not change; V2+ added flags that the V1 doc doesn't mention (effect ON bit 6, timbre mode BOTH).
  * Timbre byte 254 (insert-effect assignment) semantics for values >= 4 unresolved (see 06).
  * PCG global != SysEx global: PCG lacks the first 2 SysEx bytes at the start and has 5 extra trailing bytes;
    category names verified at PCG offset 146; the rest inferred.
  * Multisample 0x1000|n values in user programs are undocumented (likely RAM/Flash PBS-TRI samples).
  * Drum-sample numbering: doc range 0..258 (0x102) -- Trinity Basic Guide says 258 drumsamples.
  * Name lists come from a third-party hand-typed panel -> typos; indices validated by sound-type matches.
  * S-bank (Solo-TRI, 521 B) layout is in scans p184-187 (TABLE 2) but was not transcribed.
