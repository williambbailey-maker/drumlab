import { assignRoles, type StemRole } from './lib/roles'
import type { IngestFile } from './lib/ingest'
import type { TrackAudio } from './lib/decoder'

export type TrackStatus = 'decoding' | 'ready' | 'error'

export interface Track {
  id: string
  name: string
  path: string
  file: File
  status: TrackStatus
  error?: string
  audio?: TrackAudio
  role: StemRole
  roleSource: 'guessed' | 'user'
  mute: boolean
  solo: boolean
}

export interface Project {
  name: string
  tracks: Track[]
  skipped: number
}

export type Action =
  | { type: 'open'; name: string; files: IngestFile[]; ids: string[]; skipped: number }
  | { type: 'decoded'; id: string; audio: TrackAudio }
  | { type: 'decode-error'; id: string; error: string }
  | { type: 'set-role'; id: string; role: StemRole }
  | { type: 'toggle-mute'; id: string }
  | { type: 'toggle-solo'; id: string }
  | { type: 'clear-solo' }
  | { type: 'close' }

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2)
}

function update(tracks: Track[], id: string, patch: (t: Track) => Track): Track[] {
  return tracks.map((t) => (t.id === id ? patch(t) : t))
}

export function reducer(state: Project | null, action: Action): Project | null {
  switch (action.type) {
    case 'open': {
      const roles = assignRoles(action.files.map((f) => f.file.name))
      return {
        name: action.name,
        skipped: action.skipped,
        tracks: action.files.map((f, i) => ({
          id: action.ids[i],
          name: f.file.name,
          path: f.path,
          file: f.file,
          status: 'decoding',
          role: roles[i],
          roleSource: 'guessed',
          mute: false,
          solo: false,
        })),
      }
    }
    case 'close':
      return null
  }
  if (!state) return state
  switch (action.type) {
    case 'decoded':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, status: 'ready', audio: action.audio, error: undefined })) }
    case 'decode-error':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, status: 'error', error: action.error })) }
    case 'set-role':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, role: action.role, roleSource: 'user' })) }
    case 'toggle-mute':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, mute: !t.mute })) }
    case 'toggle-solo':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, solo: !t.solo })) }
    case 'clear-solo':
      return { ...state, tracks: state.tracks.map((t) => (t.solo ? { ...t, solo: false } : t)) }
  }
}

export function projectDuration(project: Project | null): number {
  if (!project) return 0
  let d = 0
  for (const t of project.tracks) if (t.audio) d = Math.max(d, t.audio.length / t.audio.sampleRate)
  return d
}
