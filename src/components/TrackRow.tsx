import { memo } from 'react'
import { mergePeaks, toDb } from '../lib/peaks'
import { formatDb, formatRate, formatTime } from '../lib/format'
import type { StemRole } from '../lib/roles'
import type { Track } from '../state'
import { RolePicker } from './RolePicker'
import { Waveform } from './Waveform'

export const LABEL_COL = 300
export const CONTROL_COL = 88

interface Props {
  track: Track
  rolesInUse: readonly StemRole[]
  duplicate: boolean
  dimmed: boolean
  onRole: (id: string, role: StemRole) => void
  onMute: (id: string) => void
  onSolo: (id: string) => void
  onSeek: (fraction: number) => void
}

function TrackRowImpl({ track, rolesInUse, duplicate, dimmed, onRole, onMute, onSolo, onSeek }: Props) {
  const a = track.audio
  const peaks = a ? mergePeaks(a.peaks) : null
  const meta = a
    ? [
        formatRate(a.sampleRate),
        a.format === 'float' ? `${a.bitDepth}-bit float` : `${a.bitDepth}-bit`,
        a.channels.length === 1 ? 'mono' : a.channels.length === 2 ? 'stereo' : `${a.channels.length} ch`,
        formatTime(a.length / a.sampleRate),
        `${formatDb(toDb(a.peak))} dBFS`,
      ].join(' · ')
    : null

  return (
    <div
      className="grid border-b border-rule-soft"
      style={{ gridTemplateColumns: `${LABEL_COL}px minmax(0, 1fr) ${CONTROL_COL}px` }}
      data-track-id={track.id}
    >
      <div className="flex min-w-0 flex-col justify-center gap-1 py-3 pl-8 pr-4">
        <RolePicker
          value={track.role}
          inUse={rolesInUse}
          source={track.roleSource}
          duplicate={duplicate}
          onChange={(r) => onRole(track.id, r)}
        />
        <div className="truncate text-sm text-ink" title={track.path}>
          {track.name}
        </div>
        {track.status === 'error' ? (
          <div className="font-mono text-[11px] text-rust">{track.error}</div>
        ) : (
          <div className="font-mono text-[11px] text-muted">{meta ?? 'decoding…'}</div>
        )}
      </div>

      <div className={`relative h-20 min-w-0 text-wave transition-opacity ${dimmed ? 'opacity-30' : ''}`}>
        {track.status === 'decoding' && (
          <div className="absolute inset-0 animate-pulse bg-rule-soft/60" aria-hidden />
        )}
        <Waveform peaks={peaks} onSeek={onSeek} className="cursor-text" />
      </div>

      <div className="flex items-center justify-center gap-1.5">
        <ToggleButton label="M" title="Mute" active={track.mute} activeClass="bg-ink text-paper border-ink" onClick={() => onMute(track.id)} />
        <ToggleButton label="S" title="Solo" active={track.solo} activeClass="bg-amber text-ink border-amber" onClick={() => onSolo(track.id)} />
      </div>
    </div>
  )
}

function ToggleButton({
  label,
  title,
  active,
  activeClass,
  onClick,
}: {
  label: string
  title: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 w-7 rounded border font-mono text-xs font-medium transition-colors ${
        active ? activeClass : 'border-rule bg-transparent text-ink-soft hover:border-ink-soft'
      }`}
    >
      {label}
    </button>
  )
}

export const TrackRow = memo(TrackRowImpl)
