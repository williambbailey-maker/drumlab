/** Pure filters used by the fix renderer. */
import { fromDb, toDb } from './levels'

/** RBJ biquad notch, applied causally. */
export function notch(x: Float32Array, freq: number, q: number, sampleRate: number): Float32Array {
  const w0 = (2 * Math.PI * freq) / sampleRate
  const alpha = Math.sin(w0) / (2 * q)
  const cosw = Math.cos(w0)
  const a0 = 1 + alpha
  const b0 = 1 / a0
  const b1 = (-2 * cosw) / a0
  const b2 = 1 / a0
  const a1 = (-2 * cosw) / a0
  const a2 = (1 - alpha) / a0
  const out = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = xi
    y2 = y1
    y1 = yi
    out[i] = yi
  }
  return out
}

export function notchAll(x: Float32Array, freqs: readonly number[], q: number, sampleRate: number): Float32Array {
  let out = x
  for (const f of freqs) if (f < sampleRate / 2) out = notch(out, f, q, sampleRate)
  return out === x ? new Float32Array(x) : out
}

export function gain(x: Float32Array, db: number): Float32Array {
  const g = fromDb(db)
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g
  return out
}

export interface ExpanderParams {
  thresholdDb: number
  /** Downward ratio: 2 means 1 dB under the threshold becomes 2 dB under. */
  ratio: number
  /** Maximum attenuation, dB. */
  rangeDb: number
  attackMs: number
  releaseMs: number
}

/**
 * Downward expander with an RMS detector (so its threshold reads on the same
 * scale as the measured floor). Signal below the threshold is pushed further
 * down by `ratio`, up to `rangeDb`. Attack opens fast on hits; release lets
 * tails through.
 */
export function expand(x: Float32Array, p: ExpanderParams, sampleRate: number): Float32Array {
  const out = new Float32Array(x.length)
  const att = Math.exp(-1 / ((p.attackMs / 1000) * sampleRate))
  const rel = Math.exp(-1 / ((p.releaseMs / 1000) * sampleRate))
  const thr = fromDb(p.thresholdDb)
  let env2 = 0
  let g = 1
  for (let i = 0; i < x.length; i++) {
    const sq = x[i] * x[i]
    env2 = sq > env2 ? att * env2 + (1 - att) * sq : rel * env2 + (1 - rel) * sq
    const env = Math.sqrt(env2)
    let target = 1
    if (env < thr) {
      const under = toDb(thr) - toDb(Math.max(env, 1e-9))
      const reduction = Math.min(p.rangeDb, under * (p.ratio - 1))
      target = fromDb(-reduction)
    }
    // Gain moves with the same time constants so it never clicks.
    g = target < g ? att * g + (1 - att) * target : rel * g + (1 - rel) * target
    out[i] = x[i] * g
  }
  return out
}
