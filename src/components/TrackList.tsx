import { useCallback, useRef } from 'react'
import type { PlaybackEngine } from '../audio/engine'
import { useAnimationFrame } from '../hooks/useAnimationFrame'
import type { StemRole } from '../lib/roles'
import type { Project } from '../state'
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
}

export function TrackList({ project, engine, playing, duration, positionTick, onRole, onMute, onSolo, onSeek }: Props) {
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
      el.style.left = `calc(${LABEL_COL}px + ${frac} * (100% - ${LABEL_COL + CONTROL_COL}px))`
    },
    [duration, positionTick],
  )

  const seekFraction = useCallback((f: number) => onSeek(f * duration), [onSeek, duration])

  const rolesInUse = project.tracks.map((t) => t.role)
  const roleCounts = new Map<StemRole, number>()
  for (const r of rolesInUse) roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1)
  const anySolo = project.tracks.some((t) => t.solo)

  return (
    <div className="relative">
      <div className="grid border-b-0" style={{ gridTemplateColumns: `${LABEL_COL}px minmax(0, 1fr) ${CONTROL_COL}px` }}>
        <div className="border-b border-rule pl-8 font-display text-xs italic leading-6 text-muted">track</div>
        <Ruler duration={duration} onSeek={seekFraction} />
        <div className="border-b border-rule text-center font-display text-xs italic leading-6 text-muted">mix</div>
      </div>
      {project.tracks.map((t) => (
        <TrackRow
          key={t.id}
          track={t}
          rolesInUse={rolesInUse}
          duplicate={t.role !== 'other' && (roleCounts.get(t.role) ?? 0) > 1}
          dimmed={t.mute || (anySolo && !t.solo)}
          onRole={onRole}
          onMute={onMute}
          onSolo={onSolo}
          onSeek={seekFraction}
        />
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
