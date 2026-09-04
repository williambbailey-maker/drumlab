import { beforeEach, describe, expect, it } from 'vitest'
import { analyzeTake, fixesFor } from './analyze'
import { expand, notchAll } from './filters'
import { goertzelPower, measureHum } from './hum'
import { activeSpan, clipping } from './levels'
import { renderFixed } from './render'
import { add, delayed, hits, noise, resetSeed, scale } from './fixtures'
import type { AnalysisInput, AnalysisTrack } from './types'

const SR = 48000
const SECS = 4
const N = SR * SECS

function tone(freq: number, amp: number, n = N): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return out
}

function run(tracks: AnalysisTrack[], applied: Record<string, boolean> = {}, mainsHz: 50 | 60 | null = 60) {
  const input: AnalysisInput = { tracks, region: { start: 0, end: SECS }, applied, expectedLeadMs: {}, mainsHz }
  return analyzeTake(input).findings
}

function basicTake(extra: Partial<Record<'kickIn' | 'ohR' | 'hat', Float32Array>> = {}): AnalysisTrack[] {
  resetSeed()
  const snare = hits(SR, SECS, 200, 25, 10)
  const kick = hits(SR, SECS, 60, 10, 6, 0.7)
  const hat = hits(SR, SECS, 3000, 60, 20, 0.3)
  const n = () => noise(N, 0.005)
  const oh = add(delayed(snare, 100), delayed(scale(kick, 0.6), 150), delayed(scale(hat, 0.8), 90))
  return [
    { id: 'ohl', role: 'oh_l', sampleRate: SR, samples: add(oh, n()) },
    { id: 'ohr', role: 'oh_r', sampleRate: SR, samples: extra.ohR ?? add(delayed(oh, 12), n()) },
    { id: 'st', role: 'snare_top', sampleRate: SR, samples: add(snare, n()) },
    { id: 'ki', role: 'kick_in', sampleRate: SR, samples: extra.kickIn ?? add(kick, n()) },
    { id: 'hh', role: 'hat', sampleRate: SR, samples: extra.hat ?? add(hat, n()) },
  ]
}

describe('goertzel', () => {
  it('reads the RMS level of a sine at its frequency', () => {
    const x = tone(60, 0.1)
    const p = goertzelPower(x, 0, SR, 60, SR)
    expect(10 * Math.log10(p)).toBeCloseTo(20 * Math.log10(0.1 / Math.SQRT2), 0)
    expect(goertzelPower(x, 0, SR, 67, SR)).toBeLessThan(p / 100)
  })
})

describe('hum', () => {
  beforeEach(() => resetSeed())

  it('finds injected 60 Hz hum with harmonics and notches it out', () => {
    const drum = add(hits(SR, SECS, 200, 25, 8, 0.7), noise(N, 0.002))
    const hummed = add(drum, tone(60, 0.01), tone(180, 0.004))
    const r = measureHum(hummed, 0, N, SR, 60)
    expect(r.mainsHz).toBe(60)
    expect(r.significant.map((h) => h.freq)).toContain(60)
    expect(r.significant.map((h) => h.freq)).toContain(180)
    expect(r.levelDb).toBeGreaterThan(-45)
    expect(r.levelDb).toBeLessThan(-40)
    const clean = notchAll(hummed, [60, 180], 30, SR)
    const after = measureHum(clean, 0, N, SR, 60)
    expect(after.levelDb).toBeLessThan(r.levelDb - 15)
  })

  it('ignores digital-silence padding when picking quiet blocks', () => {
    const drum = add(hits(SR, SECS, 200, 25, 8, 0.7), noise(N, 0.002), tone(60, 0.01))
    const padded = new Float32Array(N + SR * 6)
    padded.set(drum, SR * 3)
    const r = measureHum(padded, 0, padded.length, SR, 60)
    expect(r.significant.map((h) => h.freq)).toContain(60)
    expect(r.levelDb).toBeGreaterThan(-50)
  })

  it('picks the mains family when none is given', () => {
    const hummed = add(hits(SR, SECS, 200, 25, 10), tone(50, 0.01), tone(100, 0.005))
    expect(measureHum(hummed, 0, N, SR, null).mainsHz).toBe(50)
  })

  it('reports nothing on a clean track', () => {
    const clean = add(hits(SR, SECS, 200, 25, 10), noise(N, 0.002))
    expect(measureHum(clean, 0, N, SR, 60).significant).toHaveLength(0)
  })

  it('does not mistake a kick tuned to 60 Hz for mains hum', () => {
    const kick = add(hits(SR, SECS, 60, 10, 8, 0.8), noise(N, 0.002))
    expect(measureHum(kick, 0, N, SR, 60).significant).toHaveLength(0)
  })

  it('surfaces as an off-by-default finding with a notch fix', () => {
    const tracks = basicTake({ kickIn: add(hits(SR, SECS, 60, 10, 6, 0.7), tone(60, 0.01), tone(120, 0.005), noise(N, 0.002)) })
    const f = run(tracks).find((x) => x.id === 'ki:hum')!
    expect(f.severity).toBe('warn')
    expect(f.fix).toMatchObject({ kind: 'notch' })
    expect((f.fix as { freqs: number[] }).freqs).toContain(60)
    expect(f.applied).toBe(false)
    expect(run(tracks).find((x) => x.id === 'st:hum')!.severity).toBe('ok')
  })
})

describe('pair balance', () => {
  it('levels OH R to OH L automatically', () => {
    resetSeed()
    const base = basicTake()
    const ohR = scale(base[1].samples, Math.pow(10, -3 / 20))
    const tracks = basicTake({ ohR })
    const f = run(tracks).find((x) => x.id === 'ohr:pair')!
    expect(f.fix).toMatchObject({ kind: 'gain' })
    expect((f.fix as { db: number }).db).toBeCloseTo(3, 0)
    expect(f.applied).toBe(true)
  })

  it('leaves a matched pair alone', () => {
    const f = run(basicTake()).find((x) => x.id === 'ohr:pair')!
    expect(f.severity).toBe('ok')
    expect(f.fix).toBeUndefined()
  })
})

describe('expansion', () => {
  it('suggests an expander on a hat mic full of snare bleed, off by default', () => {
    resetSeed()
    const snare = hits(SR, SECS, 200, 25, 10)
    const hat = add(hits(SR, SECS, 3000, 60, 20, 0.3), scale(snare, 0.25), noise(N, 0.02))
    const f = run(basicTake({ hat })).find((x) => x.id === 'hh:expansion')!
    expect(f.fix).toMatchObject({ kind: 'expand', ratio: 2 })
    expect(f.applied).toBe(false)
  })

  it('an expander pushes the floor down and leaves hits alone', () => {
    resetSeed()
    const x = add(hits(SR, SECS, 200, 25, 10), noise(N, 0.02))
    const y = expand(x, { thresholdDb: -26, ratio: 2, rangeDb: 12, attackMs: 2, releaseMs: 120 }, SR)
    // Quiet stretch near the start (before the first hit) should drop by close to the full range.
    let qx = 0
    let qy = 0
    for (let i = 2000; i < 6000; i++) {
      qx += x[i] * x[i]
      qy += y[i] * y[i]
    }
    expect(10 * Math.log10(qy / qx)).toBeLessThan(-9)
    let px = 0
    let py = 0
    for (let i = 0; i < N; i++) {
      px = Math.max(px, Math.abs(x[i]))
      py = Math.max(py, Math.abs(y[i]))
    }
    expect(py / px).toBeGreaterThan(0.9)
  })
})

describe('clipping and trims', () => {
  it('counts flat-topped runs', () => {
    const x = new Float32Array(1000)
    for (let i = 100; i < 110; i++) x[i] = 1
    for (let i = 500; i < 503; i++) x[i] = -1
    expect(clipping(x, 0, x.length)).toEqual({ runs: 2, longest: 10 })
  })

  it('flags a clipped track and a silent track', () => {
    const tracks = basicTake()
    const clipped = tracks[3].samples.map((v) => Math.max(-1, Math.min(1, v * 3)))
    tracks[3] = { ...tracks[3], samples: clipped }
    tracks[4] = { ...tracks[4], samples: new Float32Array(N) }
    const fs = run(tracks)
    expect(fs.find((x) => x.id === 'ki:format:level')!.title).toBe('Clipped on the way in')
    expect(fs.find((x) => x.id === 'hh:format:level')!.title).toBe('Track is silent')
    expect(fs.find((x) => x.id === 'st:format:level')!.severity).toBe('ok')
  })

  it('finds the active span', () => {
    const x = new Float32Array(N)
    const h = hits(SR, 1, 200, 25, 3)
    x.set(h, SR * 2)
    const span = activeSpan(x, SR)!
    expect(span.first).toBeGreaterThanOrEqual(SR * 2 - SR * 0.1)
    expect(span.last).toBeLessThanOrEqual(SR * 3 + SR * 0.2)
  })

  it('suggests one take-wide trim when the ends are silent, and renders it', () => {
    const tracks = basicTake().map((t) => {
      const padded = new Float32Array(N + SR * 6)
      padded.set(t.samples, SR * 3)
      return { ...t, samples: padded }
    })
    const input: AnalysisInput = { tracks, region: { start: 0, end: SECS + 6 }, applied: { 'st:trims': true }, expectedLeadMs: {}, mainsHz: 60 }
    const fs = analyzeTake(input).findings
    const trims = fs.filter((f) => f.stage === 'trims')
    expect(trims).toHaveLength(tracks.length)
    const fix = trims[0].fix as { kind: string; start: number; end: number }
    expect(fix.kind).toBe('trim')
    expect(fix.start / SR).toBeGreaterThan(2)
    expect(fix.start / SR).toBeLessThan(3)
    expect(trims.every((t) => JSON.stringify(t.fix) === JSON.stringify(fix))).toBe(true)
    const st = tracks.find((t) => t.id === 'st')!
    const out = renderFixed(st.samples, fixesFor(fs, 'st'), SR)
    expect(out.length).toBe(fix.end - fix.start)
  })
})
