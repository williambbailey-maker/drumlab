/**
 * Runs the checks in the fixed pipeline order on a user-selected region:
 * format → DC → polarity → alignment. Each stage measures audio that already
 * carries the applied fixes of the stages before it, so bypassing an
 * upstream fix and re-running re-measures everything downstream.
 */
import { isTomRole, type StemRole } from '../lib/roles'
import { measureDc, removeDcInPlace } from './dc'
import { estimateAlignment, type AlignResult } from './xcorr'
import { measureHum } from './hum'
import { notchAll } from './filters'
import { activeSpan, blockRms, clipping, peak, percentile, rms, toDb } from './levels'
import { STAGE_ORDER, type AnalysisInput, type AnalysisResult, type AnalysisTrack, type Finding, type Fix, type Region, type Stage } from './types'

const DC_THRESHOLD = 0.001 // −60 dBFS
const CONFIDENT_RHO = 0.2
const MAX_LAG_MS = 20
const ALIGN_MIN_MS = 0.1
const HUM_LEVEL_DB = -75
const PAIR_TOLERANCE_DB = 1
const EXPANSION_CREST_DB = 35
const TRIM_HEAD_SEC = 0.5
const TRIM_TAIL_SEC = 2
const TRIM_MIN_SEC = 1

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

  for (const t of tracks) {
    const [s, e] = regionSamples(input.region, t.sampleRate, t.samples.length)
    const pk = peak(t.samples, s, e)
    const clip = clipping(t.samples, s, e)
    if (pk < 0.001) {
      push({
        id: `${t.id}:format:level`,
        trackId: t.id,
        stage: 'format',
        severity: 'error',
        title: 'Track is silent',
        detail: 'Peaks below −60 dBFS in the region. Check the input, the mute, or the export.',
        measure: `${fmtDb(toDb(pk))} dBFS`,
        auto: false,
      })
    } else if (clip.runs > 0) {
      push({
        id: `${t.id}:format:level`,
        trackId: t.id,
        stage: 'format',
        severity: 'error',
        title: 'Clipped on the way in',
        detail: `${clip.runs} run${clip.runs === 1 ? '' : 's'} of flat-topped samples (longest ${clip.longest}). Nothing here can restore that; lower the interface gain next time.`,
        measure: `${clip.runs} clip${clip.runs === 1 ? '' : 's'} · ${fmtDb(toDb(pk))} dBFS`,
        auto: false,
      })
    } else if (pk > 0.891) {
      push({
        id: `${t.id}:format:level`,
        trackId: t.id,
        stage: 'format',
        severity: 'warn',
        title: 'No headroom',
        detail: `Peaks at ${fmtDb(toDb(pk))} dBFS. Not clipped, but within 1 dB of full scale; a hotter hit would have been.`,
        measure: `${fmtDb(toDb(pk))} dBFS`,
        auto: false,
      })
    } else {
      push({
        id: `${t.id}:format:level`,
        trackId: t.id,
        stage: 'format',
        severity: 'ok',
        title: 'Healthy level',
        detail: `Peaks at ${fmtDb(toDb(pk))} dBFS, no clipping.`,
        measure: `${fmtDb(toDb(pk))} dBFS`,
        auto: false,
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

  const isOh = (t: AnalysisTrack) => t.role === 'oh_l' || t.role === 'oh_r' || t.role === 'oh_mono'

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
  } else {
    const primaries = tracks.filter((t) => !isOh(t) && isPrimary(t.role))
    const partners = tracks.filter((t) => !isOh(t) && !isPrimary(t.role))
    for (const t of primaries) {
      const w = work.get(t.id)!
      const r = compare(ref, w, MAX_LAG_MS)
      polarityFinding(w, ref, r, refLabel, false)
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
  }

  // ---- alignment ----------------------------------------------------------
  for (const t of tracks) {
    if (!ref || isOh(t)) continue
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
    const f = push({
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
    if (f.applied) {
      const d = -r.lagSamples
      const shifted = new Float32Array(w.wav.length)
      if (d >= 0) shifted.set(w.wav.subarray(0, Math.max(0, w.wav.length - d)), d)
      else shifted.set(w.wav.subarray(-d))
      w.wav = shifted
    }
  }

  // ---- hum ----------------------------------------------------------------
  for (const w of work.values()) {
    const sr = w.track.sampleRate
    const hum = measureHum(w.wav, w.start, w.end, sr, input.mainsHz)
    const sig = hum.significant.filter((h) => h.levelDb > HUM_LEVEL_DB)
    if (sig.length > 0) {
      const freqs = sig.map((h) => h.freq)
      const strongest = sig.reduce((a, b) => (b.levelDb > a.levelDb ? b : a))
      const f = push({
        id: `${w.track.id}:hum`,
        trackId: w.track.id,
        stage: 'hum',
        severity: 'warn',
        title: `${hum.mainsHz} Hz hum`,
        detail: `Tones at ${freqs.join(', ')} Hz sit ${strongest.prominenceDb.toFixed(0)} dB above the surrounding spectrum in the quiet gaps, strongest at ${strongest.freq} Hz (${fmtDb(strongest.levelDb)} dBFS). Suggested fix: narrow notches at those frequencies. Off by default; try it and listen to the low end.`,
        measure: `${fmtDb(strongest.levelDb)} dBFS @ ${strongest.freq} Hz`,
        fix: { kind: 'notch', freqs, q: 30 },
        auto: false,
      })
      if (f.applied) w.wav = notchAll(w.wav, freqs, 30, sr)
    } else {
      push({
        id: `${w.track.id}:hum`,
        trackId: w.track.id,
        stage: 'hum',
        severity: 'ok',
        title: `No ${hum.mainsHz} Hz hum`,
        detail: `Nothing at ${hum.mainsHz} Hz or its harmonics stands out in the quiet gaps (strongest ${fmtDb(hum.levelDb)} dBFS).`,
        measure: `${fmtDb(hum.levelDb)} dBFS`,
        auto: false,
      })
    }
  }

  // ---- pair balance -------------------------------------------------------
  const levelDb = (w: Working) => toDb(rms(w.wav, w.start, w.end))
  const balancePair = (a: AnalysisTrack | undefined, b: AnalysisTrack | undefined, labelA: string, labelB: string, auto: boolean, targetDb: number) => {
    if (!a || !b) return
    const wa = work.get(a.id)!
    const wb = work.get(b.id)!
    const diff = levelDb(wb) - levelDb(wa) // positive: b louder than a
    const off = diff - targetDb
    const id = `${b.id}:pair`
    if (Math.abs(off) <= PAIR_TOLERANCE_DB) {
      push({
        id,
        trackId: b.id,
        stage: 'pair',
        severity: 'ok',
        title: `${labelB} balanced with ${labelA}`,
        detail: `${labelB} sits ${fmtDb(diff)} dB relative to ${labelA}${targetDb ? ` (target ${fmtDb(targetDb)} dB)` : ''}.`,
        measure: `${fmtDb(diff)} dB`,
        auto: false,
        referenceId: a.id,
      })
      return
    }
    const f = push({
      id,
      trackId: b.id,
      stage: 'pair',
      severity: auto ? 'warn' : 'info',
      title: auto
        ? off > 0
          ? `${labelB} louder than ${labelA}`
          : `${labelB} quieter than ${labelA}`
        : off > 0
          ? `${labelB} hotter than usual against ${labelA}`
          : `${labelB} lower than usual against ${labelA}`,
      detail: auto
        ? `${labelB} reads ${fmtDb(diff)} dB against ${labelA} over the region. Trimmed by ${fmtDb(-off)} dB so the pair sits level.`
        : `${labelB} reads ${fmtDb(diff)} dB against ${labelA}. A conventional print puts it around ${fmtDb(targetDb)} dB; the suggested trim of ${fmtDb(-off)} dB gets there. Off by default because this is taste, not a fault.`,
      measure: `${fmtDb(diff)} dB`,
      fix: { kind: 'gain', db: Math.round(-off * 10) / 10 },
      auto,
      referenceId: a.id,
    })
    if (f.applied) {
      const g = Math.pow(10, -off / 20)
      for (let i = 0; i < wb.wav.length; i++) wb.wav[i] *= g
    }
  }
  balancePair(ohL, ohR, 'OH L', 'OH R', true, 0)
  balancePair(byRole('room_l'), byRole('room_r'), 'Room L', 'Room R', true, 0)
  balancePair(byRole('snare_top'), byRole('snare_bottom'), 'snare top', 'Snare bottom', false, -6)
  balancePair(byRole('kick_in'), byRole('kick_out'), 'kick in', 'Kick out', false, -3)

  // ---- expansion ----------------------------------------------------------
  for (const w of work.values()) {
    const sr = w.track.sampleRate
    const blocks = blockRms(w.wav, w.start, w.end, Math.round(sr * 0.02))
    const dbs = Array.from(blocks, toDb).filter((d) => d > -Infinity)
    if (dbs.length < 10) continue
    const floor = percentile(dbs, 10)
    const hitsDb = percentile(dbs, 97)
    const crest = hitsDb - floor
    const bleedProne = w.track.role === 'hat' || w.track.role === 'snare_bottom' || w.track.role === 'kick_out' || isTomRole(w.track.role)
    if (crest < EXPANSION_CREST_DB && !isOh(w.track) && !w.track.role.startsWith('room')) {
      const thresholdDb = floor + 8
      push({
        id: `${w.track.id}:expansion`,
        trackId: w.track.id,
        stage: 'expansion',
        severity: bleedProne ? 'warn' : 'info',
        title: 'Bleed between hits',
        detail: `Between hits this mic sits at ${fmtDb(floor)} dBFS against hits at ${fmtDb(hitsDb)} dBFS, ${crest.toFixed(0)} dB apart. Suggested fix: a gentle downward expander (threshold ${fmtDb(thresholdDb)} dBFS, 2:1, up to 12 dB). Off by default; it changes the feel of the room in this mic.`,
        measure: `floor ${fmtDb(floor)} · hits ${fmtDb(hitsDb)} dBFS`,
        fix: { kind: 'expand', thresholdDb, ratio: 2, rangeDb: 12, attackMs: 2, releaseMs: 120 },
        auto: false,
      })
    } else {
      push({
        id: `${w.track.id}:expansion`,
        trackId: w.track.id,
        stage: 'expansion',
        severity: 'ok',
        title: isOh(w.track) || w.track.role.startsWith('room') ? 'Bleed is the point here' : 'Bleed under control',
        detail: `Between hits ${fmtDb(floor)} dBFS, hits ${fmtDb(hitsDb)} dBFS (${crest.toFixed(0)} dB apart).`,
        measure: `floor ${fmtDb(floor)} · hits ${fmtDb(hitsDb)} dBFS`,
        auto: false,
      })
    }
  }

  // ---- trims (take-wide, same cut on every stem) ------------------------------
  {
    let first = Infinity
    let last = 0
    const sr = tracks[0].sampleRate
    for (const t of tracks) {
      const span = activeSpan(t.samples, t.sampleRate)
      if (!span) continue
      first = Math.min(first, span.first)
      last = Math.max(last, span.last)
    }
    if (first !== Infinity) {
      const start = Math.max(0, first - Math.round(TRIM_HEAD_SEC * sr))
      const end = Math.min(longest, last + Math.round(TRIM_TAIL_SEC * sr))
      const headSec = start / sr
      const tailSec = (longest - end) / sr
      const worth = headSec >= TRIM_MIN_SEC || tailSec >= TRIM_MIN_SEC
      for (const t of tracks) {
        if (worth) {
          push({
            id: `${t.id}:trims`,
            trackId: t.id,
            stage: 'trims',
            severity: 'info',
            title: 'Silence at the ends',
            detail: `${headSec.toFixed(1)} s before the first hit and ${tailSec.toFixed(1)} s after the last decay. Suggested fix: trim every stem to the same span on export, keeping ${TRIM_HEAD_SEC} s of lead-in and ${TRIM_TAIL_SEC} s of tail. Off by default; applies to all stems together so they stay aligned, and playback here stays full length.`,
            measure: `head ${headSec.toFixed(1)} s · tail ${tailSec.toFixed(1)} s`,
            fix: { kind: 'trim', start, end },
            auto: false,
          })
        } else {
          push({
            id: `${t.id}:trims`,
            trackId: t.id,
            stage: 'trims',
            severity: 'ok',
            title: 'Tight ends',
            detail: `${headSec.toFixed(1)} s before the first hit, ${tailSec.toFixed(1)} s after the last decay.`,
            measure: `head ${headSec.toFixed(1)} s · tail ${tailSec.toFixed(1)} s`,
            auto: false,
          })
        }
      }
    }
  }

  return { findings, elapsedMs: now() - t0 }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roleName(role: StemRole): string {
  return role.replace('_', ' ')
}

/**
 * Fixes for one track in pipeline order, applied ones only. Trims are an
 * export-time cut: pass `{ forPlayback: true }` to leave them out so raw and
 * fixed stay in lockstep for A/B.
 */
export function fixesFor(findings: readonly Finding[], trackId: string, opts: { forPlayback?: boolean } = {}): Fix[] {
  const order = (s: Stage) => STAGE_ORDER.indexOf(s)
  return findings
    .filter((f) => f.trackId === trackId && f.fix && f.applied && !(opts.forPlayback && f.stage === 'trims'))
    .sort((a, b) => order(a.stage) - order(b.stage))
    .map((f) => f.fix!)
}

/** The applied take-wide trim, if any, in samples. */
export function appliedTrim(findings: readonly Finding[]): { start: number; end: number } | null {
  const f = findings.find((x) => x.stage === 'trims' && x.applied && x.fix?.kind === 'trim')
  return f && f.fix?.kind === 'trim' ? { start: f.fix.start, end: f.fix.end } : null
}
