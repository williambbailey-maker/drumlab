/**
 * Runs the checks in the fixed pipeline order on a user-selected region:
 * format → DC → polarity → alignment. Each stage measures audio that already
 * carries the applied fixes of the stages before it, so bypassing an
 * upstream fix and re-running re-measures everything downstream.
 */
import { isTomRole, type StemRole } from '../lib/roles'
import { measureDc, removeDcInPlace } from './dc'
import { estimateAlignment, type AlignResult } from './xcorr'
import type { AnalysisInput, AnalysisResult, AnalysisTrack, Finding, Fix, Region, Stage } from './types'

const DC_THRESHOLD = 0.001 // −60 dBFS
const CONFIDENT_RHO = 0.2
const MAX_LAG_MS = 20
const ALIGN_MIN_MS = 0.1

const db = (x: number) => (x <= 0 ? -Infinity : 20 * Math.log10(x))
const fmtDb = (x: number) => (x === -Infinity ? '−∞' : x.toFixed(1).replace('-', '−'))
const fmtMs = (ms: number, digits = 2) => `${ms < 0 ? '−' : ms > 0 ? '+' : ''}${Math.abs(ms).toFixed(digits)} ms`
const fmtRho = (r: number) => `ρ ${Math.abs(r).toFixed(2)}`

interface Working {
  track: AnalysisTrack
  /** Region-bounded working copy that accumulates applied fixes. */
  wav: Float32Array
  /** Working copy indices covering the analysed region. */
  start: number
  end: number
}

function regionSamples(region: Region, sr: number, length: number): [number, number] {
  const s = Math.max(0, Math.min(length, Math.round(region.start * sr)))
  const e = Math.max(s, Math.min(length, Math.round(region.end * sr)))
  return [s, e]
}

function isPrimary(role: StemRole): boolean {
  return (
    role === 'kick_in' ||
    role === 'snare_top' ||
    role === 'hat' ||
    isTomRole(role) ||
    role === 'room_l' ||
    role === 'room_r' ||
    role === 'room_mono' ||
    role === 'other'
  )
}

const PARTNER: Partial<Record<StemRole, StemRole>> = { snare_bottom: 'snare_top', kick_out: 'kick_in' }

export function analyzeTake(input: AnalysisInput): AnalysisResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const findings: Finding[] = []
  const decided = (id: string, auto: boolean) => input.applied[id] ?? auto

  const push = (f: Omit<Finding, 'applied'>): Finding => {
    const finding: Finding = { ...f, applied: f.fix ? decided(f.id, f.auto) : false }
    findings.push(finding)
    return finding
  }

  const tracks = input.tracks
  if (tracks.length === 0) return { findings, elapsedMs: 0 }

  // ---- format -------------------------------------------------------------
  const rates = new Map<number, number>()
  for (const t of tracks) rates.set(t.sampleRate, (rates.get(t.sampleRate) ?? 0) + 1)
  const refRate = [...rates.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const longest = tracks.reduce((m, t) => Math.max(m, t.samples.length), 0)

  for (const t of tracks) {
    if (t.sampleRate !== refRate) {
      push({
        id: `${t.id}:format:rate`,
        trackId: t.id,
        stage: 'format',
        severity: 'error',
        title: 'Sample rate differs from the take',
        detail: `This file is ${t.sampleRate / 1000} kHz while most tracks are ${refRate / 1000} kHz. Re-export it at the session rate; the lab does not resample.`,
        measure: `${t.sampleRate / 1000}k vs ${refRate / 1000}k`,
        auto: false,
      })
    }
    if (t.samples.length !== longest) {
      const missingMs = ((longest - t.samples.length) / t.sampleRate) * 1000
      push({
        id: `${t.id}:format:length`,
        trackId: t.id,
        stage: 'format',
        severity: 'info',
        title: 'Shorter than the longest track',
        detail: `Padded with silence at the end so every stem has the same length.`,
        measure: `${fmtMs(missingMs, 1).replace('+', '')} short`,
        fix: { kind: 'pad', length: longest },
        auto: true,
      })
    }
  }

  // Working copies bounded to the region (plus a margin for lag searches).
  const work = new Map<string, Working>()
  for (const t of tracks) {
    const [s, e] = regionSamples(input.region, t.sampleRate, t.samples.length)
    const margin = Math.round((MAX_LAG_MS / 1000) * t.sampleRate) * 2
    const ws = Math.max(0, s - margin)
    const we = Math.min(t.samples.length, e + margin)
    work.set(t.id, { track: t, wav: t.samples.slice(ws, we), start: s - ws, end: e - ws })
  }

  // ---- DC -----------------------------------------------------------------
  for (const w of work.values()) {
    const offset = measureDc(w.wav, w.start, w.end)
    if (Math.abs(offset) > DC_THRESHOLD) {
      const f = push({
        id: `${w.track.id}:dc`,
        trackId: w.track.id,
        stage: 'dc',
        severity: 'warn',
        title: 'DC offset',
        detail: `The waveform sits ${offset > 0 ? 'above' : 'below'} zero by ${fmtDb(db(Math.abs(offset)))} dBFS. Removed by subtracting the measured offset.`,
        measure: `${offset > 0 ? '+' : '−'}${Math.abs(offset).toFixed(4)} · ${fmtDb(db(Math.abs(offset)))} dBFS`,
        fix: { kind: 'dc', offset },
        auto: true,
      })
      if (f.applied) removeDcInPlace(w.wav, offset)
    } else {
      push({
        id: `${w.track.id}:dc`,
        trackId: w.track.id,
        stage: 'dc',
        severity: 'ok',
        title: 'No DC offset',
        detail: 'Mean level over the region is below −60 dBFS.',
        measure: `${fmtDb(db(Math.abs(offset)))} dBFS`,
        auto: false,
      })
    }
  }

  // ---- polarity -----------------------------------------------------------
  const byRole = (role: StemRole) => tracks.find((t) => t.role === role)
  const ohL = byRole('oh_l')
  const ohR = byRole('oh_r')
  const ohM = byRole('oh_mono')

  const flip = (w: Working) => {
    for (let i = 0; i < w.wav.length; i++) w.wav[i] = -w.wav[i]
  }

  const compare = (ref: Working, w: Working, maxLagMs: number): AlignResult =>
    estimateAlignment(ref.wav, w.wav, w.track.sampleRate, w.start, w.end, { maxLagMs })

  const polarityFinding = (w: Working, ref: Working, r: AlignResult, refLabel: string, expectInverted: boolean) => {
    const confident = Math.abs(r.rho) >= CONFIDENT_RHO
    const inverted = r.polarity === -1
    if (!confident) {
      push({
        id: `${w.track.id}:polarity`,
        trackId: w.track.id,
        stage: 'polarity',
        severity: 'info',
        title: `Polarity vs ${refLabel} inconclusive`,
        detail: `Correlation with ${refLabel} is too weak to call (${fmtRho(r.rho)}). Left as recorded.`,
        measure: fmtRho(r.rho),
        auto: false,
        referenceId: ref.track.id,
      })
      return
    }
    if (inverted) {
      const f = push({
        id: `${w.track.id}:polarity`,
        trackId: w.track.id,
        stage: 'polarity',
        severity: 'warn',
        title: `Inverted against ${refLabel}`,
        detail: expectInverted
          ? `As expected for this mic pair, the waveform is inverted relative to ${refLabel} (${fmtRho(r.rho)}). Flipped so both push the same way.`
          : `The waveform is inverted relative to ${refLabel} (${fmtRho(r.rho)}). Flipped to match.`,
        measure: `inverted · ${fmtRho(r.rho)}`,
        fix: { kind: 'flip' },
        auto: true,
        referenceId: ref.track.id,
      })
      if (f.applied) flip(w)
    } else {
      push({
        id: `${w.track.id}:polarity`,
        trackId: w.track.id,
        stage: 'polarity',
        severity: 'ok',
        title: `Polarity matches ${refLabel}`,
        detail: `In phase with ${refLabel} at the measured offset (${fmtRho(r.rho)}).`,
        measure: `matches · ${fmtRho(r.rho)}`,
        auto: false,
        referenceId: ref.track.id,
      })
    }
  }

  // Overhead pair first: OH R against OH L.
  let ref: Working | null = null
  let refLabel = ''
  if (ohL && ohR) {
    const wl = work.get(ohL.id)!
    const wr = work.get(ohR.id)!
    const r = compare(wl, wr, 3)
    polarityFinding(wr, wl, r, 'OH L', false)
    push({
      id: `${ohR.id}:alignment`,
      trackId: ohR.id,
      stage: 'alignment',
      severity: 'ok',
      title: 'Spaced pair, left as recorded',
      detail: `OH R arrives ${fmtMs(r.lagMs)} relative to OH L. A spaced pair is not time-aligned; that offset is the stereo image.`,
      measure: fmtMs(r.lagMs),
      auto: false,
      referenceId: ohL.id,
    })
    const mix = new Float32Array(wl.wav.length)
    for (let i = 0; i < mix.length; i++) mix[i] = 0.5 * (wl.wav[i] + (wr.wav[i] ?? 0))
    ref = { track: { ...ohL, id: 'oh-mix', samples: mix }, wav: mix, start: wl.start, end: wl.end }
    refLabel = 'the overheads'
  } else if (ohM || ohL || ohR) {
    const t = (ohM ?? ohL ?? ohR)!
    ref = work.get(t.id)!
    refLabel = 'the overhead'
  }

  if (!ref) {
    for (const t of tracks) {
      push({
        id: `${t.id}:polarity`,
        trackId: t.id,
        stage: 'polarity',
        severity: 'info',
        title: 'No overhead to compare against',
        detail: 'Polarity and alignment need an overhead reference. Set a track to OH L/R or OH mono and re-run.',
        measure: 'no reference',
        auto: false,
      })
    }
    return { findings, elapsedMs: now() - t0 }
  }

  const isOh = (t: AnalysisTrack) => t.role === 'oh_l' || t.role === 'oh_r' || t.role === 'oh_mono'
  const primaries = tracks.filter((t) => !isOh(t) && isPrimary(t.role))
  const partners = tracks.filter((t) => !isOh(t) && !isPrimary(t.role))

  const alignResults = new Map<string, AlignResult>()
  for (const t of primaries) {
    const w = work.get(t.id)!
    const r = compare(ref, w, MAX_LAG_MS)
    polarityFinding(w, ref, r, refLabel, false)
    alignResults.set(t.id, r)
  }
  for (const t of partners) {
    const w = work.get(t.id)!
    const partnerRole = PARTNER[t.role]
    const partner = partnerRole ? byRole(partnerRole) : undefined
    if (partner) {
      const wp = work.get(partner.id)!
      const r = compare(wp, w, 5)
      polarityFinding(w, wp, r, roleName(partner.role), true)
    } else {
      const r = compare(ref, w, MAX_LAG_MS)
      polarityFinding(w, ref, r, refLabel, false)
    }
  }

  // ---- alignment ----------------------------------------------------------
  for (const t of tracks) {
    if (isOh(t)) continue
    const w = work.get(t.id)!
    const r = compare(ref, w, MAX_LAG_MS)
    const confident = Math.abs(r.rho) >= CONFIDENT_RHO || r.envRho >= 0.3
    const expected = input.expectedLeadMs[t.role]
    const expectation =
      expected !== undefined ? ` Kit profile expects about ${fmtMs(-expected)} from mic spacing.` : ''
    if (!confident) {
      push({
        id: `${t.id}:alignment`,
        trackId: t.id,
        stage: 'alignment',
        severity: 'info',
        title: 'Alignment inconclusive',
        detail: `Could not find a clear time relationship with ${refLabel} (${fmtRho(r.rho)}). Left as recorded.${expectation}`,
        measure: fmtMs(r.lagMs),
        auto: false,
        referenceId: ref.track.id,
      })
      continue
    }
    if (Math.abs(r.lagMs) < ALIGN_MIN_MS) {
      push({
        id: `${t.id}:alignment`,
        trackId: t.id,
        stage: 'alignment',
        severity: 'ok',
        title: `Already aligned with ${refLabel}`,
        detail: `Within ${ALIGN_MIN_MS} ms of ${refLabel}.`,
        measure: fmtMs(r.lagMs),
        auto: false,
        referenceId: ref.track.id,
      })
      continue
    }
    const earlier = r.lagSamples < 0
    push({
      id: `${t.id}:alignment`,
      trackId: t.id,
      stage: 'alignment',
      severity: 'warn',
      title: earlier ? `Arrives before ${refLabel}` : `Arrives after ${refLabel}`,
      detail: `${earlier ? 'Delayed' : 'Advanced'} by ${Math.abs(r.lagMs).toFixed(2)} ms (${Math.abs(r.lagSamples)} samples) to line up with ${refLabel}.${expectation}`,
      measure: `${fmtMs(r.lagMs)} · ${fmtRho(r.rho)}`,
      fix: { kind: 'shift', samples: -r.lagSamples },
      auto: true,
      referenceId: ref.track.id,
    })
  }

  return { findings, elapsedMs: now() - t0 }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roleName(role: StemRole): string {
  return role.replace('_', ' ')
}

/** Fixes for one track in pipeline order, applied ones only. */
export function fixesFor(findings: readonly Finding[], trackId: string): Fix[] {
  const order: Record<Stage, number> = { format: 0, dc: 1, polarity: 2, alignment: 3 }
  return findings
    .filter((f) => f.trackId === trackId && f.fix && f.applied)
    .sort((a, b) => order[a.stage] - order[b.stage])
    .map((f) => f.fix!)
}
