import { beforeEach, describe, expect, it } from 'vitest'
import { analyzeTake, fixesFor } from './analyze'
import { add, delayed, flipped, hits, noise, resetSeed, scale, withDc } from './fixtures'
import type { AnalysisInput, AnalysisTrack } from './types'
import { renderFixed } from './render'

const SR = 48000
const SECS = 3

function take(): { tracks: AnalysisTrack[]; parts: Record<string, Float32Array> } {
  resetSeed()
  const snare = hits(SR, SECS, 200, 25, 8)
  const kick = hits(SR, SECS, 60, 10, 5, 0.7)
  const hat = hits(SR, SECS, 3000, 60, 16, 0.3)
  const n = () => noise(SR * SECS, 0.01)
  // Overheads hear everything at "distance": snare 2.1 ms, kick 3.1 ms later than close mics.
  const ohBase = add(delayed(snare, 100), delayed(scale(kick, 0.6), 150), delayed(scale(hat, 0.8), 90))
  const ohL = add(ohBase, n())
  const ohR = add(delayed(ohBase, 12), n())
  const tracks: AnalysisTrack[] = [
    { id: 'ohl', role: 'oh_l', sampleRate: SR, samples: ohL },
    { id: 'ohr', role: 'oh_r', sampleRate: SR, samples: ohR },
    { id: 'st', role: 'snare_top', sampleRate: SR, samples: add(snare, scale(kick, 0.1), n()) },
    { id: 'sb', role: 'snare_bottom', sampleRate: SR, samples: add(flipped(delayed(snare, 14)), n()) },
    { id: 'ki', role: 'kick_in', sampleRate: SR, samples: withDc(add(kick, n()), 0.015) },
    { id: 'ko', role: 'kick_out', sampleRate: SR, samples: add(delayed(scale(kick, 0.8), 40), n()) },
    { id: 'hh', role: 'hat', sampleRate: SR, samples: add(hat, scale(snare, 0.2), n()) },
  ]
  return { tracks, parts: { snare, kick, hat } }
}

function run(tracks: AnalysisTrack[], applied: Record<string, boolean> = {}) {
  const input: AnalysisInput = {
    tracks,
    region: { start: 0, end: SECS },
    applied,
    expectedLeadMs: { snare_top: 2.1 },
    mainsHz: 60,
  }
  return analyzeTake(input)
}

const byId = (fs: ReturnType<typeof run>['findings'], id: string) => fs.find((f) => f.id === id)!

describe('analyzeTake', () => {
  beforeEach(() => resetSeed())

  it('finds the injected DC offset on kick in and nothing elsewhere', () => {
    const { tracks } = take()
    const { findings } = run(tracks)
    const dc = byId(findings, 'ki:dc')
    expect(dc.severity).toBe('warn')
    expect(dc.fix).toMatchObject({ kind: 'dc' })
    expect((dc.fix as { offset: number }).offset).toBeCloseTo(0.015, 3)
    expect(dc.applied).toBe(true)
    expect(byId(findings, 'st:dc').severity).toBe('ok')
  })

  it('flips the inverted snare bottom against the top and leaves the top alone', () => {
    const { tracks } = take()
    const { findings } = run(tracks)
    const sb = byId(findings, 'sb:polarity')
    expect(sb.fix).toEqual({ kind: 'flip' })
    expect(sb.referenceId).toBe('st')
    expect(sb.applied).toBe(true)
    expect(byId(findings, 'st:polarity').severity).toBe('ok')
    expect(byId(findings, 'ki:polarity').fix).toBeUndefined()
    expect(byId(findings, 'ohr:polarity').severity).toBe('ok')
  })

  it('measures each close mic arriving before the overheads and delays it to match', () => {
    const { tracks } = take()
    const { findings } = run(tracks)
    const st = byId(findings, 'st:alignment')
    expect(st.fix).toMatchObject({ kind: 'shift' })
    // OH mix is the average of L and L delayed by 12: snare lands ~106 samples late. Allow slack.
    const shift = (st.fix as { samples: number }).samples
    expect(shift).toBeGreaterThanOrEqual(98)
    expect(shift).toBeLessThanOrEqual(114)
    expect(st.detail).toContain('Kit profile expects')
    const ki = byId(findings, 'ki:alignment')
    expect((ki.fix as { samples: number }).samples).toBeGreaterThanOrEqual(146)
    expect((ki.fix as { samples: number }).samples).toBeLessThanOrEqual(164)
    // Spaced pair is reported, not aligned.
    expect(byId(findings, 'ohr:alignment').fix).toBeUndefined()
  })

  it('pads shorter tracks to the longest', () => {
    const { tracks } = take()
    tracks[6] = { ...tracks[6], samples: tracks[6].samples.slice(0, SR * 2) }
    const { findings } = run(tracks)
    const f = byId(findings, 'hh:format:length')
    expect(f.fix).toEqual({ kind: 'pad', length: SR * SECS })
    expect(f.applied).toBe(true)
  })

  it('flags a sample-rate mismatch without a fix', () => {
    const { tracks } = take()
    tracks[6] = { ...tracks[6], sampleRate: 44100 }
    const { findings } = run(tracks)
    const f = byId(findings, 'hh:format:rate')
    expect(f.severity).toBe('error')
    expect(f.fix).toBeUndefined()
  })

  it('honours a bypass and re-measures downstream', () => {
    const { tracks } = take()
    const first = run(tracks).findings
    expect(byId(first, 'sb:polarity').applied).toBe(true)
    // Bypass the snare-top→bottom flip: the bottom is then still inverted vs the overheads,
    // and its alignment measured against them reflects that (negative rho).
    const second = run(tracks, { 'sb:polarity': false }).findings
    expect(byId(second, 'sb:polarity').applied).toBe(false)
    expect(byId(second, 'sb:alignment').measure).toContain('ρ')
    const rhoFirst = Number(byId(first, 'sb:alignment').measure.split('ρ ')[1])
    const rhoSecond = Number(byId(second, 'sb:alignment').measure.split('ρ ')[1])
    expect(rhoFirst).toBeGreaterThan(0)
    expect(rhoSecond).toBeGreaterThan(0)
  })

  it('renders applied fixes so a fixed close mic lines up with the overheads', () => {
    const { tracks, parts } = take()
    const { findings } = run(tracks)
    const st = tracks.find((t) => t.id === 'st')!
    const fixed = renderFixed(st.samples, fixesFor(findings, 'st'), SR)
    // After the shift, the snare in the fixed top mic should sit within a few samples of the overhead snare.
    const ohSnare = delayed(parts.snare, 106)
    let best = 0
    let bestK = 0
    for (let k = -20; k <= 20; k++) {
      let s = 0
      for (let i = 1000; i < fixed.length - 1000; i += 7) s += fixed[i] * (ohSnare[i + k] ?? 0)
      if (s > best) {
        best = s
        bestK = k
      }
    }
    expect(Math.abs(bestK)).toBeLessThanOrEqual(8)
  })
})
