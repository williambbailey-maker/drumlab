# drum-lab

Web tool that ingests multitrack drum stems, detects recording problems,
bakes safe fixes into new stems, and writes a settings sheet for Pro Tools.
See `CLAUDE.md` for the product rules.

## Status

Step 1, ingestion: drop a folder of WAVs, decode them off the main thread,
guess stem roles from filenames, draw waveforms, and play the stems summed to
stereo with per-track mute and solo. No analysis yet.

## Develop

```
npm install
npm run dev        # Vite dev server
npm test           # Vitest unit tests (roles, WAV codec, peaks)
npm run typecheck  # tsc -b
npm run build      # production build to dist/
```

## Layout

- `src/lib/` pure functions: WAV decode/encode, peaks, role guessing, ingest.
- `src/workers/decode.worker.ts` decodes files and computes peaks off-thread.
- `src/audio/engine.ts` Web Audio playback only (sum to stereo, mute/solo).
- `src/components/` UI.
