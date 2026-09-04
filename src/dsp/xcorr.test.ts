import { beforeEach, describe, expect, it } from 'vitest'
import { estimateAlignment, loudestWindow } from './xcorr'
import { add, delayed, flipped, hits, noise, resetSeed, scale } from './fixtures'

const SR = 48000

describe('estimateAlignment', () => {
  beforeEach(() => resetSeed())

  it('finds zero lag and positive polarity for an identical copy', () => {
    const a = add(hits(SR, 3, 180, 20, 6), noise(SR * 3, 0.01))
    const r = estimateAlignment(a, a, SR, 0, a.length, { maxLagMs: 20 })
    expect(r.lagSamples).toBe(0)
    expect(r.polarity).toBe(1)
    expect(r.rho).toBeGreaterThan(0.95)
  })

  it('finds the delay of a delayed copy', () => {
    const a = add(hits(SR, 3, 180, 20, 6), noise(SR * 3, 0.01))
    const b = delayed(a, 137)
    const r = estimateAlignment(a, b, SR, 0, a.length, { maxLagMs: 20 })
    expect(r.lagSamples).toBe(137)
    expect(r.lagMs).toBeCloseTo(2.85, 1)
    expect(r.polarity).toBe(1)
  })

  it('finds a negative lag when the track leads the reference', () => {
    const a = add(hits(SR, 3, 180, 20, 6), noise(SR * 3, 0.01))
    const b = delayed(a, -96)
    const r = estimateAlignment(a, b, SR, 0, a.length, { maxLagMs: 20 })
    expect(r.lagSamples).toBe(-96)
  })

  it('detects a flipped, delayed copy under bleed and noise', () => {
    const snare = hits(SR, 3, 200, 25, 8)
    const kick = hits(SR, 3, 60, 10, 5, 0.6)
    const ref = add(snare, scale(kick, 0.7), noise(SR * 3, 0.02)) // overhead-like
    const trk = add(flipped(delayed(snare, -110)), noise(SR * 3, 0.02), scale(delayed(kick, 30), 0.15)) // close mic, early, inverted
    const r = estimateAlignment(ref, trk, SR, 0, ref.length, { maxLagMs: 20 })
    expect(Math.abs(r.lagSamples + 110)).toBeLessThanOrEqual(1)
    expect(r.polarity).toBe(-1)
    expect(Math.abs(r.rho)).toBeGreaterThan(0.3)
  })

  it('reports weak correlation for unrelated signals', () => {
    const a = hits(SR, 2, 180, 20, 6)
    const b = noise(SR * 2, 0.3)
    const r = estimateAlignment(a, b, SR, 0, a.length, { maxLagMs: 20 })
    expect(Math.abs(r.rho)).toBeLessThan(0.1)
  })

  it('respects the analysis region', () => {
    const a = add(hits(SR, 4, 180, 20, 8), noise(SR * 4, 0.01))
    const b = delayed(a, 50)
    const r = estimateAlignment(a, b, SR, SR, 3 * SR, { maxLagMs: 20 })
    expect(r.lagSamples).toBe(50)
  })
})

describe('loudestWindow', () => {
  it('picks the window containing the loud part', () => {
    const x = new Float32Array(10000)
    for (let i = 6000; i < 7000; i++) x[i] = 1
    const w = loudestWindow(x, 0, x.length, 2000)
    expect(w).toBeGreaterThanOrEqual(5000)
    expect(w).toBeLessThanOrEqual(6000)
  })
})
