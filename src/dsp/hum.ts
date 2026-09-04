/**
 * Mains hum detection with the Goertzel algorithm on the quietest blocks of
 * the region. Hum is continuous, so the quiet gaps between hits show it best.
 */
import { blockRms, toDb } from './levels'

export interface HumHarmonic {
  freq: number
  /** Level of the tone, dBFS (RMS-referenced). */
  levelDb: number
  /** How far the tone stands above the spectrum just beside it, dB. */
  prominenceDb: number
  /** Spread of the tone's level across quiet blocks, dB. Mains hum is steady; drum tails are not. */
  spreadDb: number
}

export interface HumResult {
  mainsHz: 50 | 60
  harmonics: HumHarmonic[]
  /** Level of the strongest harmonic, dBFS. */
  levelDb: number
  /** Harmonics standing clearly above their surroundings. */
  significant: HumHarmonic[]
}

/** Power at `freq` in x[start, end) with a Hann window, normalised so a full-scale sine reads 1. */
export function goertzelPower(x: Float32Array, start: number, end: number, freq: number, sampleRate: number): number {
  const n = end - start
  if (n <= 0) return 0
  const k = (2 * Math.PI * freq) / sampleRate
  const coeff = 2 * Math.cos(k)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let wsum = 0
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    wsum += w
    s0 = x[start + i] * w + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  // Amplitude of a sine of amplitude A is A·wsum/2, so normalise to peak amplitude then to RMS.
  const amp = (2 * Math.sqrt(Math.max(0, power))) / wsum
  return (amp * amp) / 2
}

export function measureHum(x: Float32Array, start: number, end: number, sampleRate: number, mainsHz: 50 | 60 | null): HumResult {
  const block = Math.round(sampleRate * 0.2)
  const blocks = blockRms(x, start, end, block)
  // Digital silence (padding from a DAW export) carries no hum; only rank blocks with signal in them.
  const live = Array.from(blocks.keys()).filter((i) => blocks[i] > 1e-6)
  const order = live.sort((a, b) => blocks[a] - blocks[b])
  const quiet = order.slice(0, Math.max(3, Math.floor(order.length * 0.25)))

  const candidates: Array<50 | 60> = mainsHz ? [mainsHz] : [50, 60]
  let best: HumResult | null = null
  for (const mains of candidates) {
    const harmonics: HumHarmonic[] = []
    for (let h = 1; h <= 5; h++) {
      const f = mains * h
      const levels: number[] = []
      const proms: number[] = []
      const levelDbs: number[] = []
      for (const b of quiet) {
        const bs = start + b * block
        const be = Math.min(end, bs + block)
        if (be - bs < block / 2) continue
        const p = goertzelPower(x, bs, be, f, sampleRate)
        const side = (goertzelPower(x, bs, be, f * 1.12, sampleRate) + goertzelPower(x, bs, be, f * 0.88, sampleRate)) / 2
        levels.push(p)
        levelDbs.push(toDb(Math.sqrt(p)))
        proms.push(p > 0 && side > 0 ? 10 * Math.log10(p / side) : p > 0 ? 40 : 0)
      }
      if (levels.length === 0) continue
      const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b)
      const med = (arr: number[]) => sorted(arr)[Math.floor(arr.length / 2)]
      const dbSorted = sorted(levelDbs.filter((d) => d > -Infinity))
      const spreadDb =
        dbSorted.length >= 4 ? dbSorted[Math.floor(dbSorted.length * 0.75)] - dbSorted[Math.floor(dbSorted.length * 0.25)] : 0
      harmonics.push({ freq: f, levelDb: toDb(Math.sqrt(med(levels))), prominenceDb: med(proms), spreadDb })
    }
    const significant = harmonics.filter((h) => h.prominenceDb >= 8 && h.levelDb > -90 && h.spreadDb <= 6)
    const levelDb = harmonics.reduce((m, h) => Math.max(m, h.levelDb), -Infinity)
    const result: HumResult = { mainsHz: mains, harmonics, levelDb, significant }
    if (!best || significant.length > best.significant.length || (significant.length === best.significant.length && levelDb > best.levelDb)) {
      best = result
    }
  }
  return best!
}
