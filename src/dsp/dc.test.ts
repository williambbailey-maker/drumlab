import { describe, expect, it } from 'vitest'
import { measureDc, removeDc } from './dc'
import { hits, withDc } from './fixtures'
import { applyFix, renderFixed } from './render'

describe('DC', () => {
  it('measures an injected offset and removes it', () => {
    const x = withDc(hits(48000, 1, 100, 20, 4), 0.02)
    const dc = measureDc(x, 0, x.length)
    expect(dc).toBeCloseTo(0.02, 3)
    const y = removeDc(x, dc)
    expect(Math.abs(measureDc(y, 0, y.length))).toBeLessThan(1e-6)
  })
  it('measures near zero on a clean signal', () => {
    const x = hits(48000, 1, 100, 20, 4)
    expect(Math.abs(measureDc(x, 0, x.length))).toBeLessThan(1e-3)
  })
})

describe('fixes', () => {
  const x = new Float32Array([0.1, 0.2, 0.3, 0.4])
  it('pad', () => {
    expect(Array.from(applyFix(x, { kind: 'pad', length: 6 }, 48000))).toEqual([0.1, 0.2, 0.3, 0.4, 0, 0].map((v) => Math.fround(v)))
  })
  it('flip', () => {
    expect(Array.from(applyFix(x, { kind: 'flip' }, 48000))).toEqual([-0.1, -0.2, -0.3, -0.4].map((v) => Math.fround(v)))
  })
  it('shift delays with zeros in front and keeps length', () => {
    expect(Array.from(applyFix(x, { kind: 'shift', samples: 2 }, 48000))).toEqual([0, 0, 0.1, 0.2].map((v) => Math.fround(v)))
    expect(Array.from(applyFix(x, { kind: 'shift', samples: -1 }, 48000))).toEqual([0.2, 0.3, 0.4, 0].map((v) => Math.fround(v)))
  })
  it('trim cuts to the span', () => {
    expect(Array.from(applyFix(x, { kind: 'trim', start: 1, end: 3 }, 48000))).toEqual([0.2, 0.3].map((v) => Math.fround(v)))
  })
  it('gain scales', () => {
    expect(applyFix(x, { kind: 'gain', db: 6.0206 }, 48000)[1]).toBeCloseTo(0.4, 3)
  })
  it('renderFixed applies in order and never mutates input', () => {
    const y = renderFixed(x, [{ kind: 'dc', offset: 0.1 }, { kind: 'flip' }, { kind: 'shift', samples: 1 }], 48000)
    expect(Array.from(y).map((v) => Math.round(v * 100) / 100 + 0)).toEqual([0, 0, -0.1, -0.2])
    expect(x[0]).toBeCloseTo(0.1)
  })
})
