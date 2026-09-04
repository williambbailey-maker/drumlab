import { describe, expect, it } from 'vitest'
import { reducer, splitRole, type Project } from './state'
import type { TrackAudio } from './lib/decoder'

const file = (name: string) => ({ file: { name } as File, path: name })

function audio(channels: number): TrackAudio {
  const ch = Array.from({ length: channels }, (_, i) => new Float32Array([0.1 * (i + 1), -0.5 * (i + 1)]))
  return {
    sampleRate: 48000,
    bitDepth: 24,
    format: 'pcm',
    length: 2,
    channels: ch,
    peaks: ch.map((c) => ({ min: new Float32Array([c[1]]), max: new Float32Array([c[0]]) })),
    peak: 1,
  }
}

function open(names: string[]): Project {
  const p = reducer(null, { type: 'open', name: 'Take', files: names.map(file), ids: names.map((n) => `id-${n}`), skipped: 0 })
  if (!p) throw new Error('no project')
  return p
}

describe('reducer open', () => {
  it('assigns the attic kit roles to the user’s Pro Tools track names', () => {
    const p = open(['overheads.L.wav', 'overheads.R.wav', 'room.wav', 'kik out.wav', 'hi hat.wav', 'snr b.wav', 'snr t.wav', 'kik in.wav'])
    expect(p.tracks.map((t) => t.role)).toEqual(['oh_l', 'oh_r', 'room_mono', 'kick_out', 'hat', 'snare_bottom', 'snare_top', 'kick_in'])
    expect(p.tracks.every((t) => t.roleSource === 'guessed')).toBe(true)
  })

  it('falls back to input numbers for bare DAW names', () => {
    const p = open(['Audio 1.wav', 'Audio 8.wav'])
    expect(p.tracks.map((t) => [t.role, t.roleSource])).toEqual([
      ['oh_l', 'kit'],
      ['kick_in', 'kit'],
    ])
  })
})

describe('reducer decoded', () => {
  it('keeps mono files as one track', () => {
    const p = reducer(open(['kik in.wav']), { type: 'decoded', id: 'id-kik in.wav', audio: audio(1) })!
    expect(p.tracks).toHaveLength(1)
    expect(p.tracks[0].status).toBe('ready')
  })

  it('splits a stereo overhead file into OH L and OH R', () => {
    const p = reducer(open(['overheads.wav', 'room.wav']), { type: 'decoded', id: 'id-overheads.wav', audio: audio(2) })!
    expect(p.tracks.map((t) => [t.id, t.name, t.role, t.status])).toEqual([
      ['id-overheads.wav:L', 'overheads.wav · L', 'oh_l', 'ready'],
      ['id-overheads.wav:R', 'overheads.wav · R', 'oh_r', 'ready'],
      ['id-room.wav', 'room.wav', 'room_mono', 'decoding'],
    ])
    expect(p.tracks[0].audio!.channels).toHaveLength(1)
    expect(p.tracks[1].audio!.channels[0][0]).toBeCloseTo(0.2)
    expect(p.tracks[1].audio!.peak).toBeCloseTo(1.0)
  })

  it('keeps the guessed role on both halves for non-pair roles', () => {
    expect(splitRole('kick_in')).toEqual(['kick_in', 'kick_in'])
    expect(splitRole('room_mono')).toEqual(['room_l', 'room_r'])
  })
})
