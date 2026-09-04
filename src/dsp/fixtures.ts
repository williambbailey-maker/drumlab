/** Synthetic drum-like signals with known answers, shared by the DSP tests. */

let seed = 12345
export function rand(): number {
  // Deterministic LCG so fixtures are reproducible.
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

export function resetSeed(s = 12345): void {
  seed = s
}

/** Decaying tone bursts at irregular positions, like a close mic on a drum. */
export function hits(sr: number, seconds: number, freq: number, decay: number, count: number, amp = 0.8): Float32Array {
  const n = Math.round(sr * seconds)
  const out = new Float32Array(n)
  for (let h = 0; h < count; h++) {
    const at = Math.round(((h + 0.3 + rand() * 0.4) / count) * n)
    const len = Math.min(n - at, Math.round(sr / decay))
    for (let i = 0; i < len; i++) {
      const t = i / sr
      out[at + i] += amp * Math.exp(-t * decay) * Math.sin(2 * Math.PI * freq * t)
    }
  }
  // Real drum hits are zero-mean; a decaying sine from phase zero is not.
  let mean = 0
  for (let i = 0; i < n; i++) mean += out[i]
  mean /= n
  for (let i = 0; i < n; i++) out[i] -= mean
  return out
}

export function noise(n: number, amp: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * (rand() * 2 - 1)
  return out
}

export function add(...xs: Float32Array[]): Float32Array {
  const out = new Float32Array(xs[0].length)
  for (const x of xs) for (let i = 0; i < out.length; i++) out[i] += x[i]
  return out
}

export function scale(x: Float32Array, k: number): Float32Array {
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i] * k
  return out
}

export function delayed(x: Float32Array, samples: number): Float32Array {
  const out = new Float32Array(x.length)
  if (samples >= 0) out.set(x.subarray(0, x.length - samples), samples)
  else out.set(x.subarray(-samples))
  return out
}

export function flipped(x: Float32Array): Float32Array {
  return scale(x, -1)
}

export function withDc(x: Float32Array, dc: number): Float32Array {
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i] + dc
  return out
}
