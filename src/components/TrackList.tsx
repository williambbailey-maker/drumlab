import { useCallback, useRef } from 'react'
import type { PlaybackEngine } from '../audio/engine'
import { useAnimationFrame } from '../hooks/useAnimationFrame'
import type { StemRole } from '../lib/roles'
import type { Region } from '../dsp/types'
import type { Project } from '../state'
import { FindingsRow } from './FindingsRow'
import { Ruler } from './Ruler'
import { CONTROL_COL, LABEL_COL, TrackRow } from './TrackRow'

interface Props {
  project: Project
  engine: PlaybackEngine
  playing: boolean
  duration: number
  /** Bumped whenever the position changes without playing (seek, stop). */
  positionTick: number
  onRole: (id: string, role: StemRole) => void
  onMute: (id: string) => void
  onSolo: (id: string) => void
  onSeek: (seconds: number) => void
  onRegion: (region: Region) => void
  onApplied: (id: string, applied: boolean) => void
  /** Applied export trim, in samples of the longest track. */
  trim: { start: number; end: number } | null
}

const waveLeft = (frac: number) => `calc(${LABEL_COL}px + ${frac} * (100% - ${LABEL_COL + CONTROL_COL}px))`
const waveWidth = (frac: number) => `calc(${frac} * (100% - ${LABEL_COL + CONTROL_COL}px))`

export function TrackList({
  project,
  engine,
  playing,
  duration,
  positionTick,
  onRole,
  onMute,
  onSolo,
  onSeek,
  onRegion,
  onApplied,
  trim,
}: Props) {
  const playhead = useRef<HTMLDivElement>(null)

  useAnimationFrame(
    playing,
    () => {
      const el = playhead.current
      if (!el) return
      if (duration <= 0) {
        el.style.display = 'none'
        return
      }
      const frac = Math.max(0, Math.min(1, engine.position / duration))
      el.style.display = ''
      el.style.left = waveLeft(frac)
    },
    [duration, positionTick],
  )

  const seekFraction = useCallback((f: number) => onSeek(f * duration), [onSeek, duration])

  const rolesInUse = project.tracks.map((t) => t.role)
  const roleCounts = new Map<StemRole, number>()
  for (const r of rolesInUse) roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1)
  const anySolo = project.tracks.some((t) => t.solo)
  const region = project.region
  const showFindings = project.findings.length > 0
  const sr = project.tracks.find((t) => t.audio)?.audio?.sampleRate ?? 48000
  const totalSamples = duration * sr
  const trimFrac = trim && totalSamples > 0 ? { start: trim.start / totalSamples, end: trim.end / totalSamples } : null

  return (
    <div className="relative">
      <div className="grid" style={{ gridTemplateColumns: `${LABEL_COL}px minmax(0, 1fr) ${CONTROL_COL}px` }}>
        <div className="border-b border-rule pl-8 font-display text-xs italic leading-6 text-muted">track</div>
        <Ruler duration={duration} region={region} onSeek={seekFraction} onRegion={onRegion} />
        <div className="border-b border-rule text-center font-display text-xs italic leading-6 text-muted">mix</div>
      </div>
      {project.tracks.map((t) => (
        <div key={t.id} className="relative">
          <TrackRow
            track={t}
            rolesInUse={rolesInUse}
            duplicate={t.role !== 'other' && (roleCounts.get(t.role) ?? 0) > 1}
            dimmed={t.mute || (anySolo && !t.solo)}
            onRole={onRole}
            onMute={onMute}
            onSolo={onSolo}
            onSeek={seekFraction}
          />
          {region && duration > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 h-20 border-x border-rust/40 bg-rust/[0.06]"
              style={{ left: waveLeft(region.start / duration), width: waveWidth((region.end - region.start) / duration) }}
            />
          )}
          {trimFrac && (
            <>
              <div
                aria-hidden
                title="Trimmed on export"
                className="pointer-events-none absolute top-0 h-20 bg-ink/10"
                style={{ left: waveLeft(0), width: waveWidth(trimFrac.start) }}
              />
              <div
                aria-hidden
                title="Trimmed on export"
                className="pointer-events-none absolute top-0 h-20 bg-ink/10"
                style={{ left: waveLeft(trimFrac.end), width: waveWidth(1 - trimFrac.end) }}
              />
            </>
          )}
          {showFindings && (
            <FindingsRow
              trackId={t.id}
              findings={project.findings.filter((f) => f.trackId === t.id)}
              soloed={t.solo}
              onApplied={onApplied}
              onSolo={onSolo}
            />
          )}
        </div>
      ))}
      <div
        ref={playhead}
        aria-hidden
        className="pointer-events-none absolute bottom-0 top-0 w-px bg-rust"
        style={{ left: `${LABEL_COL}px` }}
      />
    </div>
  )
}
