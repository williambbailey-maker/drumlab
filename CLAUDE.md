# drum-lab

Web tool that ingests multitrack drum stems, detects recording problems,
bakes safe fixes into new stems, and writes a settings sheet for Pro Tools.

## Stack
Vite + React + TypeScript + Tailwind. No backend. IndexedDB for project state.
Deploy to Vercel. Analysis runs in a Web Worker. DSP is pure functions on
Float32Array; Web Audio is only for playback and A/B.

## Non-negotiables
- Fix pipeline order is fixed: format → DC → polarity → alignment → hum →
  pair balance → expansion → trims. Never expose this as a user setting.
- Auto-apply only polarity, alignment, DC, pair balance, length/format.
  Everything else is flagged with a suggested fix and off by default.
- Every finding has Apply / Bypass / Solo. Bypassing an upstream fix
  re-measures downstream findings for that track.
- Raw stems are never modified. Export writes a sibling `<take>_fixed/` folder
  with same filenames, plus `sheet.txt`.
- Analysis works on a user-selected region (default 30 s); export renders full length.

## Stem roles
kick_in, kick_out, snare_top, snare_bottom, hat, tom_1..n, oh_l, oh_r, oh_mono,
room_l, room_r, room_mono, other. Overheads are the alignment reference.

## Testing
Every check gets a synthetic fixture with a known answer (flipped copy,
delayed copy, injected 60 Hz, etc.) before it runs on real audio.

## Design
Editorial, warm, restrained. Fraunces for headings, JetBrains Mono for numbers.
Findings grouped by track, not by pipeline stage.
