/** Min/max envelope of a signal in a fixed number of buckets, for waveform display. */
export interface Peaks {
  min: Float32Array
  max: Float32Array
}

export function computePeaks(samples: Float32Array, buckets: number): Peaks {
  const n = samples.length
  const min = new Float32Array(buckets)
  const max = new Float32Array(buckets)
  if (n === 0 || buckets === 0) return { min, max }
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * n) / buckets)
    const end = Math.max(start + 1, Math.floor(((b + 1) * n) / buckets))
    let lo = Infinity
    let hi = -Infinity
    for (let i = start; i < end && i < n; i++) {
      const v = samples[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[b] = lo === Infinity ? 0 : lo
    max[b] = hi === -Infinity ? 0 : hi
  }
  return { min, max }
}

/** Element-wise union of several channels' envelopes (for drawing a stereo file as one lane). */
export function mergePeaks(all: readonly Peaks[]): Peaks | null {
  if (all.length === 0) return null
  if (all.length === 1) return all[0]
  const n = all[0].min.length
  const min = new Float32Array(n)
  const max = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let lo = Infinity
    let hi = -Infinity
    for (const p of all) {
      if (p.min[i] < lo) lo = p.min[i]
      if (p.max[i] > hi) hi = p.max[i]
    }
    min[i] = lo
    max[i] = hi
  }
  return { min, max }
}

export function peakAbs(samples: Float32Array): number {
  let m = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > m) m = a
  }
  return m
}

export function toDb(linear: number): number {
  return linear <= 0 ? -Infinity : 20 * Math.log10(linear)
}
