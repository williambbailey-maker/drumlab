import { assignRoles, type StemRole } from './lib/roles'
import type { Finding, Region } from './dsp/types'
import type { Variant } from './audio/engine'
import { inputNumberFromName, roleForInput, type KitProfile } from './kit/profile'
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
  roleSource: 'guessed' | 'kit' | 'user'
  mute: boolean
  solo: boolean
  /** Monitor fader, dB. */
  gainDb: number
  /** Monitor pan, −1..1; null follows the role's default placement. */
  pan: number | null
}

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'stale' | 'error'

export interface Project {
  name: string
  tracks: Track[]
  skipped: number
  kit: KitProfile
  /** Analysis region in seconds; null until the take's length is known. */
  region: Region | null
  findings: Finding[]
  analysis: AnalysisStatus
  analysisError?: string
  /** User Apply/Bypass decisions by finding id; absent means the finding's default. */
  overrides: Record<string, boolean>
  variant: Variant
  masterDb: number
  mixerOpen: boolean
}

export type Action =
  | { type: 'open'; name: string; files: IngestFile[]; ids: string[]; skipped: number; kit: KitProfile }
  | { type: 'set-kit'; kit: KitProfile }
  | { type: 'decoded'; id: string; audio: TrackAudio }
  | { type: 'decode-error'; id: string; error: string }
  | { type: 'set-role'; id: string; role: StemRole }
  | { type: 'toggle-mute'; id: string }
  | { type: 'toggle-solo'; id: string }
  | { type: 'clear-solo' }
  | { type: 'set-region'; region: Region }
  | { type: 'analysis-start' }
  | { type: 'analysis-done'; findings: Finding[] }
  | { type: 'analysis-error'; error: string }
  | { type: 'set-applied'; id: string; applied: boolean }
  | { type: 'set-variant'; variant: Variant }
  | { type: 'set-gain'; id: string; gainDb: number }
  | { type: 'set-pan'; id: string; pan: number | null }
  | { type: 'set-master'; masterDb: number }
  | { type: 'toggle-mixer' }
  | { type: 'reset-mixer' }
  | { type: 'close' }

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2)
}

function update(tracks: Track[], id: string, patch: (t: Track) => Track): Track[] {
  return tracks.map((t) => (t.id === id ? patch(t) : t))
}

function rolesFor(kit: KitProfile, filenames: string[]) {
  const byInput = (name: string) => {
    const n = inputNumberFromName(name)
    return n === null ? null : roleForInput(kit, n)
  }
  return assignRoles(filenames, byInput)
}

/** Roles for the two halves of a stereo file, given the role guessed for the whole file. */
export function splitRole(role: StemRole): [StemRole, StemRole] {
  if (role === 'oh_l' || role === 'oh_r' || role === 'oh_mono') return ['oh_l', 'oh_r']
  if (role === 'room_l' || role === 'room_r' || role === 'room_mono') return ['room_l', 'room_r']
  return [role, role]
}

/**
 * A stereo interleaved file becomes two mono tracks so each side gets its own
 * role, mute/solo and later its own findings. Export re-joins them by id.
 */
function splitStereo(track: Track, audio: TrackAudio): Track[] {
  const roles = splitRole(track.role)
  const sides = ['L', 'R'] as const
  return sides.map((side, i) => ({
    ...track,
    id: `${track.id}:${side}`,
    name: `${track.name} · ${side}`,
    status: 'ready',
    error: undefined,
    role: roles[i],
    audio: {
      ...audio,
      channels: [audio.channels[i]],
      peaks: [audio.peaks[i]],
      peak: audio.channels[i].reduce((m, v) => Math.max(m, Math.abs(v)), 0),
    },
  }))
}

export function reducer(state: Project | null, action: Action): Project | null {
  switch (action.type) {
    case 'open': {
      const kit = action.kit
      const roles = rolesFor(
        kit,
        action.files.map((f) => f.file.name),
      )
      return {
        name: action.name,
        skipped: action.skipped,
        kit,
        region: null,
        findings: [],
        analysis: 'idle',
        overrides: {},
        variant: 'raw',
        masterDb: 0,
        mixerOpen: false,
        tracks: action.files.map((f, i) => ({
          id: action.ids[i],
          name: f.file.name,
          path: f.path,
          file: f.file,
          status: 'decoding',
          role: roles[i].role,
          roleSource: roles[i].source,
          mute: false,
          solo: false,
          gainDb: 0,
          pan: null,
        })),
      }
    }
    case 'close':
      return null
  }
  if (!state) return state
  switch (action.type) {
    case 'decoded': {
      if (action.audio.channels.length === 2) {
        return {
          ...state,
          tracks: state.tracks.flatMap((t) => (t.id === action.id ? splitStereo(t, action.audio) : [t])),
        }
      }
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, status: 'ready', audio: action.audio, error: undefined })) }
    }
    case 'decode-error':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, status: 'error', error: action.error })) }
    case 'set-kit': {
      // Re-guess every role the user has not set by hand, under the new profile.
      const roles = rolesFor(
        action.kit,
        state.tracks.map((t) => t.name),
      )
      return {
        ...state,
        kit: action.kit,
        analysis: stale(state.analysis),
        tracks: state.tracks.map((t, i) =>
          t.roleSource === 'user' ? t : { ...t, role: roles[i].role, roleSource: roles[i].source },
        ),
      }
    }
    case 'set-role':
      return {
        ...state,
        analysis: stale(state.analysis),
        tracks: update(state.tracks, action.id, (t) => ({ ...t, role: action.role, roleSource: 'user' })),
      }
    case 'set-region':
      return { ...state, region: action.region, analysis: stale(state.analysis) }
    case 'analysis-start':
      return { ...state, analysis: 'running', analysisError: undefined }
    case 'analysis-done':
      return { ...state, analysis: 'done', findings: action.findings, variant: action.findings.some((f) => f.applied) ? 'fixed' : state.variant }
    case 'analysis-error':
      return { ...state, analysis: 'error', analysisError: action.error }
    case 'set-applied': {
      const ids = new Set(affectedFindingIds(state.findings, action.id))
      return {
        ...state,
        overrides: overridesAfter(state.overrides, state.findings, action.id, action.applied),
        findings: state.findings.map((f) => (ids.has(f.id) ? { ...f, applied: action.applied } : f)),
      }
    }
    case 'set-gain':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, gainDb: action.gainDb })) }
    case 'set-pan':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, pan: action.pan })) }
    case 'set-master':
      return { ...state, masterDb: action.masterDb }
    case 'toggle-mixer':
      return { ...state, mixerOpen: !state.mixerOpen }
    case 'reset-mixer':
      return { ...state, masterDb: 0, tracks: state.tracks.map((t) => ({ ...t, gainDb: 0, pan: null, mute: false, solo: false })) }
    case 'set-variant':
      return { ...state, variant: action.variant }
    case 'toggle-mute':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, mute: !t.mute })) }
    case 'toggle-solo':
      return { ...state, tracks: update(state.tracks, action.id, (t) => ({ ...t, solo: !t.solo })) }
    case 'clear-solo':
      return { ...state, tracks: state.tracks.map((t) => (t.solo ? { ...t, solo: false } : t)) }
  }
}

/** Trims are one take-wide cut, so a decision on any track's trim applies to all of them. */
export function affectedFindingIds(findings: readonly Finding[], id: string): string[] {
  const target = findings.find((f) => f.id === id)
  if (target?.stage === 'trims') return findings.filter((f) => f.stage === 'trims').map((f) => f.id)
  return [id]
}

export function overridesAfter(
  overrides: Record<string, boolean>,
  findings: readonly Finding[],
  id: string,
  applied: boolean,
): Record<string, boolean> {
  const next = { ...overrides }
  for (const fid of affectedFindingIds(findings, id)) next[fid] = applied
  return next
}

function stale(status: AnalysisStatus): AnalysisStatus {
  return status === 'done' || status === 'stale' ? 'stale' : status
}

/** Default analysis region: the first 30 s, or the whole take if shorter. */
export function defaultRegion(duration: number): Region {
  return { start: 0, end: Math.min(30, duration) }
}

export function projectDuration(project: Project | null): number {
  if (!project) return 0
  let d = 0
  for (const t of project.tracks) if (t.audio) d = Math.max(d, t.audio.length / t.audio.sampleRate)
  return d
}
