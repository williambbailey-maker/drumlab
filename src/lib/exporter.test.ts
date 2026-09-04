import { describe, expect, it } from 'vitest'
import { buildExport, buildSheet, type ExportInput, type ExportTrack } from './exporter'
import { decodeWav } from './wav'
import { buildZip, crc32 } from './zip'
import { NO_KIT } from '../kit/profile'
import type { Finding } from '../dsp/types'

const SR = 48000
const sig = (n: number, v: number) => new Float32Array(n).fill(v)

function track(
  id: string,
  name: string,
  role: ExportTrack['role'],
  samples: Float32Array,
  extra: Partial<ExportTrack> = {},
): ExportTrack {
  return {
    id,
    name,
    role,
    sampleRate: SR,
    bitDepth: 24,
    format: 'pcm',
    channels: [samples],
    gainDb: 0,
    pan: null,
    mute: false,
    ...extra,
  }
}

const finding = (partial: Partial<Finding> & Pick<Finding, 'id' | 'trackId' | 'stage'>): Finding => ({
  severity: 'warn',
  title: partial.title ?? 'x',
  detail: 'd',
  measure: 'm',
  auto: true,
  applied: true,
  ...partial,
})

describe('buildExport', () => {
  it('writes same-named stems with applied fixes, rejoins stereo, and a sheet', () => {
    const tracks = [
      track('a', 'kik in.wav', 'kick_in', sig(1000, 0.5)),
      track('b:L', 'overheads.wav · L', 'oh_l', sig(1000, 0.1)),
      track('b:R', 'overheads.wav · R', 'oh_r', sig(1000, -0.1)),
    ]
    const findings: Finding[] = [
      finding({ id: 'a:polarity', trackId: 'a', stage: 'polarity', fix: { kind: 'flip' } }),
      finding({
        id: 'a:trims',
        trackId: 'a',
        stage: 'trims',
        fix: { kind: 'trim', start: 100, end: 600 },
        auto: false,
      }),
      finding({
        id: 'b:L:trims',
        trackId: 'b:L',
        stage: 'trims',
        fix: { kind: 'trim', start: 100, end: 600 },
        auto: false,
      }),
      finding({
        id: 'b:R:trims',
        trackId: 'b:R',
        stage: 'trims',
        fix: { kind: 'trim', start: 100, end: 600 },
        auto: false,
      }),
      finding({
        id: 'b:R:hum',
        trackId: 'b:R',
        stage: 'hum',
        fix: { kind: 'notch', freqs: [60], q: 30 },
        applied: false,
        title: '60 Hz hum',
      }),
    ]
    const input: ExportInput = {
      takeName: 'Take 9',
      kit: NO_KIT,
      region: { start: 0, end: 0.02 },
      tracks,
      findings,
      masterDb: -3,
      now: new Date('2026-09-04T12:00:00Z'),
    }
    const out = buildExport(input)
    expect(out.folder).toBe('Take 9_fixed')
    expect(out.files.map((f) => f.name)).toEqual(['kik in.wav', 'overheads.wav', 'sheet.txt'])

    const kick = decodeWav(
      out.files[0].data.buffer.slice(
        out.files[0].data.byteOffset,
        out.files[0].data.byteOffset + out.files[0].data.byteLength,
      ) as ArrayBuffer,
    )
    expect(kick.length).toBe(500)
    expect(kick.bitDepth).toBe(24)
    expect(kick.channels[0][0]).toBeCloseTo(-0.5, 3)

    const oh = decodeWav(
      out.files[1].data.buffer.slice(
        out.files[1].data.byteOffset,
        out.files[1].data.byteOffset + out.files[1].data.byteLength,
      ) as ArrayBuffer,
    )
    expect(oh.channels).toHaveLength(2)
    expect(oh.length).toBe(500)
    expect(oh.channels[0][0]).toBeCloseTo(0.1, 3)
    expect(oh.channels[1][0]).toBeCloseTo(-0.1, 3)

    expect(out.sheet).toContain('Take:          Take 9')
    expect(out.sheet).toContain('Polarity      Polarity: INVERT')
    expect(out.sheet).toContain('SUGGESTED, NOT APPLIED')
    expect(out.sheet).toContain('EQ III notch at 60 Hz')
    expect(out.sheet).toContain('Master         -3.0 dB')
  })

  it('sheet reports nothing gracefully', () => {
    const sheet = buildSheet({
      takeName: 'T',
      kit: NO_KIT,
      region: null,
      tracks: [track('a', 'a.wav', 'other', sig(10, 0))],
      findings: [],
      masterDb: 0,
    })
    expect(sheet).toContain('nothing applied')
    expect(sheet).toContain('NEEDS ATTENTION')
  })
})

describe('zip', () => {
  it('crc32 matches a known value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('lays out local headers, central directory and end record', () => {
    const z = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }], new Date(2026, 8, 4, 10, 0, 0))
    const dv = new DataView(z.buffer)
    expect(dv.getUint32(0, true)).toBe(0x04034b50)
    const eocd = z.length - 22
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50)
    expect(dv.getUint16(eocd + 10, true)).toBe(1)
    const cdOffset = dv.getUint32(eocd + 16, true)
    expect(dv.getUint32(cdOffset, true)).toBe(0x02014b50)
  })
})
