/**
 * Time-alignment and polarity estimation between two mono signals.
 *
 * Coarse lag comes from cross-correlating onset envelopes (decimated, cheap,
 * immune to low-frequency phase ambiguity). The fine lag and the sign come
 * from a full-band waveform cross-correlation in a short loud window around
 * the coarse lag. No FFTs: the lag ranges are small enough for direct sums.
 */

export interface AlignResult {
  /** Positive: the track arrives later than the reference. */
  lagSamples: number
  lagMs: number
  polarity: 1 | -1
  /** Normalised waveform correlation at the chosen lag, signed. */
  rho: number
  /** Normalised onset-envelope correlation at the coarse lag (always ≥ 0). */
  envRho: number
}

export interface AlignOptions {
  maxLagMs: number
  /** Refinement half-window around the coarse lag. */
  refineMs?: number
  /** Loud window used for the waveform pass. */
  fineWindowSec?: number
  envelopeRate?: number
}

/** Half-wave-rectified difference of a block-peak envelope: spikes at onsets. */
export function onsetEnvelope(x: Float32Array, start: number, end: number, decim: number): Float32Array {
  const n = Math.max(0, Math.floor((end - start) / decim))
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = start + i * decim
    let m = 0
    for (let j = s; j < s + decim; j++) {
      const a = Math.abs(x[j])
      if (a > m) m = a
    }
    env[i] = m
  }
  const out = new Float32Array(n)
  for (let i = 1; i < n; i++) out[i] = Math.max(0, env[i] - env[i - 1])
  return out
}

/**
 * r[k] = Σ_n a[n]·b[n+k] for k in [minLag, maxLag], over n where both indices are valid.
 * `aStart..aEnd` bounds n; b is indexed n+k and must be valid in [bStart, bEnd).
 */
export function xcorrDirect(
  a: Float32Array,
  b: Float32Array,
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  minLag: number,
  maxLag: number,
): Float32Array {
  const out = new Float32Array(maxLag - minLag + 1)
  for (let k = minLag; k <= maxLag; k++) {
    const n0 = Math.max(aStart, bStart - k)
    const n1 = Math.min(aEnd, bEnd - k)
    let s = 0
    for (let n = n0; n < n1; n++) s += a[n] * b[n + k]
    out[k - minLag] = s
  }
  return out
}

function energy(x: Float32Array, start: number, end: number): number {
  let e = 0
  for (let i = Math.max(0, start); i < Math.min(x.length, end); i++) e += x[i] * x[i]
  return e
}

/** Start of the `win`-sample window inside [start, end) with the most energy. */
export function loudestWindow(x: Float32Array, start: number, end: number, win: number): number {
  const len = end - start
  if (len <= win) return start
  const block = Math.max(1, Math.floor(win / 8))
  const blocks = Math.floor(len / block)
  const e = new Float64Array(blocks)
  for (let i = 0; i < blocks; i++) e[i] = energy(x, start + i * block, start + (i + 1) * block)
  const per = Math.floor(win / block)
  let best = 0
  let bestSum = -1
  let sum = 0
  for (let i = 0; i < blocks; i++) {
    sum += e[i]
    if (i >= per) sum -= e[i - per]
    if (i >= per - 1 && sum > bestSum) {
      bestSum = sum
      best = i - per + 1
    }
  }
  return start + best * block
}

export function estimateAlignment(
  ref: Float32Array,
  trk: Float32Array,
  sampleRate: number,
  start: number,
  end: number,
  opts: AlignOptions,
): AlignResult {
  const refineMs = opts.refineMs ?? 1.5
  const envRate = opts.envelopeRate ?? 4000
  const decim = Math.max(1, Math.round(sampleRate / envRate))
  const maxLag = Math.round((opts.maxLagMs / 1000) * sampleRate)

  const s = Math.max(0, start)
  const e = Math.min(end, ref.length, trk.length)

  // Coarse: onset envelopes.
  const envA = onsetEnvelope(ref, s, e, decim)
  const envB = onsetEnvelope(trk, s, e, decim)
  const envLag = Math.max(1, Math.round(maxLag / decim))
  const envCorr = xcorrDirect(envA, envB, 0, envA.length, 0, envB.length, -envLag, envLag)
  let ci = 0
  for (let i = 1; i < envCorr.length; i++) if (envCorr[i] > envCorr[ci]) ci = i
  const coarse = (ci - envLag) * decim
  const envNorm = Math.sqrt(energy(envA, 0, envA.length) * energy(envB, 0, envB.length))
  const envRho = envNorm > 0 ? envCorr[ci] / envNorm : 0

  // Fine: waveform correlation in the loudest window of the track.
  const win = Math.min(e - s, Math.round((opts.fineWindowSec ?? 4) * sampleRate))
  const w0 = loudestWindow(trk, s, e, win)
  const w1 = w0 + win
  const refine = Math.round((refineMs / 1000) * sampleRate)
  const lo = Math.max(-maxLag, coarse - refine)
  const hi = Math.min(maxLag, coarse + refine)
  // n indexes ref; trk is indexed n+k, so ref n ∈ [w0-k, w1-k) ⇒ trk sample ∈ [w0, w1).
  const corr = xcorrDirect(ref, trk, s, e, w0, w1, lo, hi)
  let bi = 0
  for (let i = 1; i < corr.length; i++) if (Math.abs(corr[i]) > Math.abs(corr[bi])) bi = i
  const lag = lo + bi
  const eb = energy(trk, w0, w1)
  const ea = energy(ref, w0 - lag, w1 - lag)
  const norm = Math.sqrt(ea * eb)
  const rho = norm > 0 ? corr[bi] / norm : 0

  return {
    lagSamples: lag,
    lagMs: (lag / sampleRate) * 1000,
    polarity: rho < 0 ? -1 : 1,
    rho,
    envRho,
  }
}
