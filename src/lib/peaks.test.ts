import { describe, expect, it } from 'vitest'
import { computePeaks, mergePeaks, peakAbs, toDb } from './peaks'

describe('computePeaks', () => {
  it('captures min and max per bucket', () => {
    const s = new Float32Array([0.1, -0.5, 0.9, 0.2, -0.1, 0.3, -0.8, 0.0])
    const p = computePeaks(s, 4)
    expect(p.min).toEqual(new Float32Array([-0.5, 0.2, -0.1, -0.8]))
    expect(p.max).toEqual(new Float32Array([0.1, 0.9, 0.3, 0]))
  })

  it('handles more buckets than samples without dropping data', () => {
    const s = new Float32Array([0.5, -0.5])
    const p = computePeaks(s, 6)
    expect(p.min.length).toBe(6)
    expect(Math.min(...p.min)).toBe(-0.5)
    expect(Math.max(...p.max)).toBe(0.5)
  })

  it('returns zeros for empty input', () => {
    const p = computePeaks(new Float32Array(0), 3)
    expect(Array.from(p.min)).toEqual([0, 0, 0])
  })
})

describe('mergePeaks', () => {
  it('takes the union envelope', () => {
    const a = { min: new Float32Array([-0.2, -0.9]), max: new Float32Array([0.3, 0.1]) }
    const b = { min: new Float32Array([-0.5, -0.1]), max: new Float32Array([0.1, 0.7]) }
    const m = mergePeaks([a, b])!
    expect(m.min).toEqual(new Float32Array([-0.5, -0.9]))
    expect(m.max).toEqual(new Float32Array([0.3, 0.7]))
  })
  it('returns null for no channels', () => {
    expect(mergePeaks([])).toBeNull()
  })
})

describe('peakAbs / toDb', () => {
  it('finds the absolute peak', () => {
    expect(peakAbs(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7)
  })
  it('converts to dBFS', () => {
    expect(toDb(1)).toBe(0)
    expect(toDb(0.5)).toBeCloseTo(-6.02, 2)
    expect(toDb(0)).toBe(-Infinity)
  })
})
