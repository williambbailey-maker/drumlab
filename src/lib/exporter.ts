/**
 * Builds the `<take>_fixed/` folder: every stem rendered with its applied
 * fixes (trims included), same filenames and format as the originals, plus
 * sheet.txt with the equivalent Pro Tools settings.
 */
import { fixesFor } from '../dsp/analyze'
import { renderFixed } from '../dsp/render'
import type { Finding, Fix, Region } from '../dsp/types'
import { STAGE_LABEL, STAGE_ORDER } from '../dsp/types'
import type { KitProfile } from '../kit/profile'
import { encodeWav } from './wav'
import { panForRole, roleLabel, type StemRole } from './roles'
import { formatTime } from './format'

export interface ExportTrack {
  id: string
  name: string
  role: StemRole
  sampleRate: number
  bitDepth: number
  format: 'pcm' | 'float'
  channels: Float32Array[]
  gainDb: number
  pan: number | null
  mute: boolean
}

export interface ExportInput {
  takeName: string
  kit: KitProfile
  region: Region | null
  tracks: ExportTrack[]
  findings: Finding[]
  masterDb: number
  now?: Date
}

export interface ExportFile {
  name: string
  data: Uint8Array
}

export interface ExportResult {
  folder: string
  files: ExportFile[]
  sheet: string
}

/** Stereo files were split into `<id>:L` / `<id>:R` on import; put them back together. */
function groupStereo(tracks: ExportTrack[]): Array<{ name: string; parts: ExportTrack[] }> {
  const groups = new Map<string, { name: string; parts: ExportTrack[] }>()
  for (const t of tracks) {
    const m = t.id.match(/^(.*):(L|R)$/)
    const key = m ? m[1] : t.id
    const name = m ? t.name.replace(/ · (L|R)$/, '') : t.name
    const g = groups.get(key) ?? { name, parts: [] }
    g.parts.push(t)
    groups.set(key, g)
  }
  for (const g of groups.values()) g.parts.sort((a, b) => (a.id.endsWith(':R') ? 1 : 0) - (b.id.endsWith(':R') ? 1 : 0))
  return [...groups.values()]
}

export function buildExport(input: ExportInput): ExportResult {
  const folder = `${input.takeName}_fixed`
  const files: ExportFile[] = []
  for (const g of groupStereo(input.tracks)) {
    const rendered = g.parts.map((t) => renderFixed(t.channels[0], fixesFor(input.findings, t.id), t.sampleRate))
    const len = Math.min(...rendered.map((r) => r.length))
    const channels = rendered.map((r) => (r.length === len ? r : r.slice(0, len)))
    const first = g.parts[0]
    const bytes = encodeWav(
      channels,
      first.sampleRate,
      first.format === 'float' ? { float: true } : { bitDepth: clampDepth(first.bitDepth) },
    )
    files.push({ name: g.name, data: new Uint8Array(bytes) })
  }
  const sheet = buildSheet(input)
  files.push({ name: 'sheet.txt', data: new TextEncoder().encode(sheet) })
  return { folder, files, sheet }
}

function clampDepth(bits: number): 16 | 24 | 32 {
  return bits <= 16 ? 16 : bits >= 32 ? 32 : 24
}

const fmtDb = (db: number) => `${db > 0 ? '+' : db < 0 ? '-' : ''}${Math.abs(db).toFixed(1)} dB`
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))

/** Pro Tools wording for a fix. Sample counts are given because PT nudges in samples. */
function proToolsLine(fix: Fix, sampleRate: number): string {
  switch (fix.kind) {
    case 'pad':
      return `Length: padded with silence to ${fix.length} samples (${formatTime(fix.length / sampleRate, 2)})`
    case 'dc':
      return `DC offset: removed ${fix.offset > 0 ? '+' : ''}${fix.offset.toFixed(5)} FS (baked into the stem; in PT use AudioSuite > Other > DC Offset Removal)`
    case 'flip':
      return `Polarity: INVERT (Trim plug-in Ø button, or Clip > Invert)`
    case 'shift': {
      const ms = (fix.samples / sampleRate) * 1000
      return fix.samples >= 0
        ? `Alignment: nudge LATER by ${fix.samples} samples (${ms.toFixed(2)} ms)`
        : `Alignment: nudge EARLIER by ${-fix.samples} samples (${(-ms).toFixed(2)} ms)`
    }
    case 'notch':
      return `Hum: EQ III notch at ${fix.freqs.map((f) => `${f} Hz`).join(', ')} (Q ${fix.q}, deepest cut)`
    case 'gain':
      return `Level: clip gain ${fmtDb(fix.db)}`
    case 'expand':
      return `Expansion: Dyn3 Expander/Gate  threshold ${fix.thresholdDb.toFixed(1)} dB, ratio ${fix.ratio}:1, range ${fix.rangeDb} dB, attack ${fix.attackMs} ms, release ${fix.releaseMs} ms`
    case 'trim':
      return `Trim: keep ${fix.start}–${fix.end} samples (${formatTime(fix.start / sampleRate, 2)} to ${formatTime(fix.end / sampleRate, 2)})`
  }
}

export function buildSheet(input: ExportInput): string {
  const now = input.now ?? new Date()
  const lines: string[] = []
  const sr = input.tracks[0]?.sampleRate ?? 0
  const depths = new Set(
    input.tracks.map((t) => (t.format === 'float' ? `${t.bitDepth}-bit float` : `${t.bitDepth}-bit`)),
  )
  lines.push(`DRUM LAB SETTINGS SHEET`)
  lines.push(`Take:          ${input.takeName}`)
  lines.push(`Written:       ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC`)
  lines.push(`Kit profile:   ${input.kit.name}${input.kit.interface ? ` (${input.kit.interface})` : ''}`)
  lines.push(`Format:        ${sr / 1000} kHz, ${[...depths].join(' / ')}`)
  if (input.region)
    lines.push(`Analysed:      ${formatTime(input.region.start, 1)} to ${formatTime(input.region.end, 1)}`)
  lines.push(`Stems:         ${input.takeName}_fixed/ (same filenames as the originals; the originals are untouched)`)
  lines.push('')
  lines.push(`The _fixed stems already have every APPLIED fix baked in. The settings below let you`)
  lines.push(`recreate the same result on the RAW stems in Pro Tools, or check what was done.`)
  lines.push('')

  const applied = input.findings.filter((f) => f.fix && f.applied)
  const suggested = input.findings.filter((f) => f.fix && !f.applied)
  const attention = input.findings.filter((f) => f.severity === 'error')

  lines.push(`== APPLIED (baked into the _fixed stems) ==`)
  for (const t of input.tracks) {
    const mine = applied
      .filter((f) => f.trackId === t.id)
      .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
    if (mine.length === 0) continue
    lines.push('')
    lines.push(`${roleLabel(t.role)}  (${t.name})`)
    for (const f of mine) lines.push(`  ${pad(STAGE_LABEL[f.stage], 13)} ${proToolsLine(f.fix!, t.sampleRate)}`)
  }
  if (applied.length === 0) lines.push('  nothing applied')

  lines.push('')
  lines.push(`== SUGGESTED, NOT APPLIED (try these on the raw stems if you agree) ==`)
  for (const t of input.tracks) {
    const mine = suggested.filter((f) => f.trackId === t.id)
    if (mine.length === 0) continue
    lines.push('')
    lines.push(`${roleLabel(t.role)}  (${t.name})`)
    for (const f of mine) {
      lines.push(`  ${pad(STAGE_LABEL[f.stage], 13)} ${proToolsLine(f.fix!, t.sampleRate)}`)
      lines.push(`  ${pad('', 13)} why: ${f.title}, ${f.measure}`)
    }
  }
  if (suggested.length === 0) lines.push('  none')

  lines.push('')
  lines.push(`== NEEDS ATTENTION (cannot be fixed here) ==`)
  for (const f of attention) {
    const t = input.tracks.find((x) => x.id === f.trackId)
    lines.push(`  ${t ? roleLabel(t.role) : f.trackId}: ${f.title} (${f.measure}). ${f.detail}`)
  }
  if (attention.length === 0) lines.push('  nothing')

  lines.push('')
  lines.push(`== MONITOR MIX USED WHILE REVIEWING (not baked in) ==`)
  lines.push(`  ${pad('Track', 14)} ${pad('Fader', 10)} ${pad('Pan', 6)} Mute`)
  for (const t of input.tracks) {
    const pan = t.pan ?? panForRole(t.role)
    const panLabel = Math.abs(pan) < 0.05 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`
    lines.push(
      `  ${pad(roleLabel(t.role), 14)} ${pad(t.gainDb <= -60 ? '-inf' : fmtDb(t.gainDb), 10)} ${pad(panLabel, 6)} ${t.mute ? 'yes' : ''}`,
    )
  }
  lines.push(`  ${pad('Master', 14)} ${fmtDb(input.masterDb)}`)

  lines.push('')
  lines.push(`== MEASUREMENTS ==`)
  for (const t of input.tracks) {
    const mine = input.findings
      .filter((f) => f.trackId === t.id)
      .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
    if (mine.length === 0) continue
    lines.push('')
    lines.push(`${roleLabel(t.role)}  (${t.name})`)
    for (const f of mine) lines.push(`  ${pad(STAGE_LABEL[f.stage], 13)} ${pad(f.measure, 32)} ${f.title}`)
  }
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Writing to disk
// ---------------------------------------------------------------------------

type DirHandle = {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<{ createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }> }>
}

export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/**
 * Writes the export beside the original take: the user picks the folder that
 * CONTAINS the take, and `<take>_fixed/` is created inside it.
 */
export async function writeToPickedFolder(result: ExportResult): Promise<'written' | 'cancelled'> {
  const picker = (window as unknown as { showDirectoryPicker: (o: { mode: 'readwrite' }) => Promise<DirHandle> })
    .showDirectoryPicker
  let parent: DirHandle
  try {
    parent = await picker({ mode: 'readwrite' })
  } catch {
    return 'cancelled'
  }
  const dir = await parent.getDirectoryHandle(result.folder, { create: true })
  for (const f of result.files) {
    const handle = await dir.getFileHandle(f.name, { create: true })
    const w = await handle.createWritable()
    await w.write(f.data)
    await w.close()
  }
  return 'written'
}
