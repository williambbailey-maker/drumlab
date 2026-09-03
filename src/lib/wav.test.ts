import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav, WavError } from './wav'

function ramp(n: number, phase = 0): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((i / n) * Math.PI * 6 + phase) * 0.9
  return out
}

function maxError(a: Float32Array, b: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

describe('encodeWav / decodeWav round trip', () => {
  const left = ramp(1000)
  const right = ramp(1000, 1.3)

  it('16-bit PCM', () => {
    const d = decodeWav(encodeWav([left, right], 44100, { bitDepth: 16 }))
    expect(d.sampleRate).toBe(44100)
    expect(d.bitDepth).toBe(16)
    expect(d.format).toBe('pcm')
    expect(d.channels).toHaveLength(2)
    expect(d.length).toBe(1000)
    // Half an LSB of rounding plus the 32767/32768 scale mismatch.
    expect(maxError(d.channels[0], left)).toBeLessThan(2 / 32768)
    expect(maxError(d.channels[1], right)).toBeLessThan(2 / 32768)
  })

  it('24-bit PCM', () => {
    const d = decodeWav(encodeWav([left], 48000, { bitDepth: 24 }))
    expect(d.bitDepth).toBe(24)
    expect(maxError(d.channels[0], left)).toBeLessThan(1 / 8000000)
  })

  it('24-bit PCM keeps sign on negative full scale', () => {
    const neg = new Float32Array([-1, -0.5, 0, 0.5, 1])
    const d = decodeWav(encodeWav([neg], 48000, { bitDepth: 24 }))
    expect(Array.from(d.channels[0]).map((x) => Math.round(x * 100) / 100)).toEqual([-1, -0.5, 0, 0.5, 1])
  })

  it('32-bit PCM', () => {
    const d = decodeWav(encodeWav([left], 96000, { bitDepth: 32 }))
    expect(d.bitDepth).toBe(32)
    expect(maxError(d.channels[0], left)).toBeLessThan(1e-7)
  })

  it('32-bit float is exact', () => {
    const d = decodeWav(encodeWav([left, right], 48000, { float: true }))
    expect(d.format).toBe('float')
    expect(maxError(d.channels[0], left)).toBe(0)
    expect(maxError(d.channels[1], right)).toBe(0)
  })
})

describe('decodeWav edge cases', () => {
  it('rejects non-WAV data', () => {
    expect(() => decodeWav(new ArrayBuffer(4))).toThrow(WavError)
    const junk = new Uint8Array(64).fill(65).buffer
    expect(() => decodeWav(junk)).toThrow(WavError)
  })

  it('tolerates a truncated data chunk', () => {
    const full = encodeWav([ramp(500)], 44100, { bitDepth: 16 })
    const cut = full.slice(0, 44 + 2 * 250 + 1)
    const d = decodeWav(cut)
    expect(d.length).toBe(250)
  })

  it('handles odd-length chunks before data', () => {
    const full = new Uint8Array(encodeWav([ramp(100)], 44100, { bitDepth: 16 }))
    // Insert a 3-byte LIST chunk (padded to 4) between fmt and data.
    const extra = new Uint8Array(8 + 4)
    extra.set([0x4c, 0x49, 0x53, 0x54], 0) // LIST
    new DataView(extra.buffer).setUint32(4, 3, true)
    const out = new Uint8Array(full.length + extra.length)
    out.set(full.subarray(0, 36), 0)
    out.set(extra, 36)
    out.set(full.subarray(36), 36 + extra.length)
    const d = decodeWav(out.buffer)
    expect(d.length).toBe(100)
  })

  it('reads WAVE_FORMAT_EXTENSIBLE', () => {
    const base = new Uint8Array(encodeWav([ramp(10)], 48000, { bitDepth: 24 }))
    const fmt = new Uint8Array(8 + 40)
    const dv = new DataView(fmt.buffer)
    fmt.set(base.subarray(12, 20), 0) // 'fmt ' + size (to be overwritten)
    dv.setUint32(4, 40, true)
    fmt.set(base.subarray(20, 36), 8) // original 16 fmt bytes
    dv.setUint16(8, 0xfffe, true)
    dv.setUint16(24, 22, true) // cbSize
    dv.setUint16(26, 24, true) // valid bits
    dv.setUint32(28, 4, true) // channel mask
    dv.setUint16(32, 1, true) // subformat = PCM
    const out = new Uint8Array(12 + fmt.length + (base.length - 36))
    out.set(base.subarray(0, 12), 0)
    out.set(fmt, 12)
    out.set(base.subarray(36), 12 + fmt.length)
    const d = decodeWav(out.buffer)
    expect(d.format).toBe('pcm')
    expect(d.bitDepth).toBe(24)
    expect(d.length).toBe(10)
  })
})
