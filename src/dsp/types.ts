import type { StemRole } from '../lib/roles'

/** The fixed pipeline order from CLAUDE.md. Never user-configurable. */
export type Stage = 'format' | 'dc' | 'polarity' | 'alignment' | 'hum' | 'pair' | 'expansion' | 'trims'

export const STAGE_ORDER: readonly Stage[] = ['format', 'dc', 'polarity', 'alignment', 'hum', 'pair', 'expansion', 'trims']

export const STAGE_LABEL: Record<Stage, string> = {
  format: 'Format',
  dc: 'DC offset',
  polarity: 'Polarity',
  alignment: 'Alignment',
  hum: 'Hum',
  pair: 'Pair balance',
  expansion: 'Expansion',
  trims: 'Trims',
}

export type Fix =
  | { kind: 'pad'; length: number }
  | { kind: 'dc'; offset: number }
  | { kind: 'flip' }
  | { kind: 'shift'; samples: number }
  | { kind: 'notch'; freqs: number[]; q: number }
  | { kind: 'gain'; db: number }
  | { kind: 'expand'; thresholdDb: number; ratio: number; rangeDb: number; attackMs: number; releaseMs: number }
  | { kind: 'trim'; start: number; end: number }

export type Severity = 'ok' | 'info' | 'warn' | 'error'

export interface Finding {
  /** Stable across re-analysis: `${trackId}:${stage}` plus an optional qualifier. */
  id: string
  trackId: string
  stage: Stage
  severity: Severity
  title: string
  detail: string
  /** Short measurement for the mono column, e.g. "−2.1 ms · ρ 0.42". */
  measure: string
  fix?: Fix
  /** Whether this fix is applied by default (the auto-apply list from CLAUDE.md). */
  auto: boolean
  applied: boolean
  /** Track this finding was measured against, if any. */
  referenceId?: string
}

export interface Region {
  start: number
  end: number
}

export interface AnalysisTrack {
  id: string
  role: StemRole
  sampleRate: number
  samples: Float32Array
}

export interface AnalysisInput {
  tracks: AnalysisTrack[]
  /** Seconds. */
  region: Region
  /** Per-finding overrides of `applied`, from the user's Apply/Bypass choices. */
  applied: Record<string, boolean>
  /** Expected lead of each role relative to the overheads, in ms, from the kit profile. */
  expectedLeadMs: Partial<Record<StemRole, number>>
  /** Mains frequency to hunt for; null tries both 50 and 60 Hz. */
  mainsHz: 50 | 60 | null
}

export interface AnalysisResult {
  findings: Finding[]
  /** Wall-clock ms spent analysing. */
  elapsedMs: number
}
