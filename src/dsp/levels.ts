/** Level statistics on Float32Array signals. All in linear unless named dB. */

export const toDb = (x: number): number => (x <= 0 ? -Infinity : 20 * Math.log10(x))
export const fromDb = (db: number): number => Math.pow(10, db / 20)

export function rms(x: Float32Array, start = 0, end = x.length): number {
  const s = Math.max(0, start)
  const e = Math.min(x.length, end)
  if (e <= s) return 0
  let sum = 0
  for (let i = s; i < e; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / (e - s))
}

export function peak(x: Float32Array, start = 0, end = x.length): number {
  let m = 0
  for (let i = Math.max(0, start); i < Math.min(x.length, end); i++) {
    const a = Math.abs(x[i])
    if (a > m) m = a
  }
  return m
}

/** RMS of consecutive blocks of `block` samples over [start, end). */
export function blockRms(x: Float32Array, start: number, end: number, block: number): Float32Array {
  const n = Math.max(0, Math.floor((end - start) / block))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = rms(x, start + i * block, start + (i + 1) * block)
  return out
}

export function percentile(values: Float32Array | number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = Array.from(values).sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

/**
 * Counts clipping events: runs of at least `minRun` consecutive samples at or
 * above `level` (absolute). Returns the number of runs and the longest run.
 */
export function clipping(x: Float32Array, start: number, end: number, level = 0.999, minRun = 3): { runs: number; longest: number } {
  let runs = 0
  let longest = 0
  let run = 0
  for (let i = Math.max(0, start); i < Math.min(x.length, end); i++) {
    if (Math.abs(x[i]) >= level) {
      run++
    } else {
      if (run >= minRun) {
        runs++
        if (run > longest) longest = run
      }
      run = 0
    }
  }
  if (run >= minRun) {
    runs++
    if (run > longest) longest = run
  }
  return { runs, longest }
}

/**
 * First and last block whose RMS exceeds `floorDb + marginDb`, in samples from
 * the start of `x`. Returns null if the track never rises above the floor.
 */
export function activeSpan(x: Float32Array, sampleRate: number, marginDb = 20): { first: number; last: number; floorDb: number } | null {
  const block = Math.round(sampleRate * 0.05)
  const blocks = blockRms(x, 0, x.length, block)
  if (blocks.length === 0) return null
  const dbs = Array.from(blocks, toDb)
  const finite = dbs.filter((d) => d > -Infinity)
  if (finite.length === 0) return null
  const floorDb = percentile(finite, 10)
  const thr = floorDb + marginDb
  let first = -1
  let last = -1
  for (let i = 0; i < dbs.length; i++) {
    if (dbs[i] > thr) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) return null
  return { first: first * block, last: Math.min(x.length, (last + 1) * block), floorDb }
}
