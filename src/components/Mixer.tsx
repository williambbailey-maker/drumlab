import { panForRole, roleLabel } from '../lib/roles'
import type { Track } from '../state'

interface Props {
  tracks: Track[]
  masterDb: number
  onGain: (id: string, gainDb: number) => void
  onPan: (id: string, pan: number | null) => void
  onMute: (id: string) => void
  onSolo: (id: string) => void
  onMaster: (db: number) => void
  onReset: () => void
}

const MIN_DB = -60
const MAX_DB = 12

const fmt = (db: number) => (db <= MIN_DB ? '−∞' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}`)
const panLabel = (p: number) => (Math.abs(p) < 0.05 ? 'C' : p < 0 ? `L${Math.round(-p * 100)}` : `R${Math.round(p * 100)}`)

/** Monitor mixer: faders, pans, mute/solo, master. Listening only; the stems are untouched. */
export function Mixer({ tracks, masterDb, onGain, onPan, onMute, onSolo, onMaster, onReset }: Props) {
  const anySolo = tracks.some((t) => t.solo)
  return (
    <section className="border-t border-rule bg-surface/95 px-8 py-4 backdrop-blur-sm" aria-label="Mixer">
      <div className="mb-3 flex items-baseline gap-4">
        <h2 className="font-display text-lg italic text-ink-soft">mixer</h2>
        <span className="font-mono text-[11px] text-muted">monitor only · double-click a fader or pan to reset it</span>
        <button type="button" onClick={onReset} className="ml-auto text-xs text-ink-soft underline-offset-4 hover:text-ink hover:underline">
          Reset all
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {tracks.map((t) => {
          const pan = t.pan ?? panForRole(t.role)
          const dimmed = t.mute || (anySolo && !t.solo)
          return (
            <Strip
              key={t.id}
              title={roleLabel(t.role)}
              subtitle={t.name}
              gainDb={t.gainDb}
              onGain={(db) => onGain(t.id, db)}
              onGainReset={() => onGain(t.id, 0)}
              dimmed={dimmed}
            >
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={pan}
                onChange={(e) => onPan(t.id, Number(e.target.value))}
                onDoubleClick={() => onPan(t.id, null)}
                aria-label={`${roleLabel(t.role)} pan`}
                className="h-1 w-full accent-ink"
              />
              <div className="font-mono text-[10px] text-muted">{panLabel(pan)}</div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onMute(t.id)}
                  aria-pressed={t.mute}
                  className={`h-6 w-6 rounded border font-mono text-[11px] ${t.mute ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'}`}
                >
                  M
                </button>
                <button
                  type="button"
                  onClick={() => onSolo(t.id)}
                  aria-pressed={t.solo}
                  className={`h-6 w-6 rounded border font-mono text-[11px] ${t.solo ? 'border-amber bg-amber text-ink' : 'border-rule text-ink-soft'}`}
                >
                  S
                </button>
              </div>
            </Strip>
          )
        })}
        <div className="mx-1 w-px self-stretch bg-rule" aria-hidden />
        <Strip title="Master" subtitle="stereo out" gainDb={masterDb} onGain={onMaster} onGainReset={() => onMaster(0)} dimmed={false} />
      </div>
    </section>
  )
}

function Strip({
  title,
  subtitle,
  gainDb,
  onGain,
  onGainReset,
  dimmed,
  children,
}: {
  title: string
  subtitle: string
  gainDb: number
  onGain: (db: number) => void
  onGainReset: () => void
  dimmed: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`flex w-[84px] shrink-0 flex-col items-center gap-2 rounded-md border border-rule-soft bg-paper/70 px-2 py-3 ${dimmed ? 'opacity-50' : ''}`}>
      <div className="w-full truncate text-center text-xs font-medium text-ink" title={subtitle}>
        {title}
      </div>
      <div className="font-mono text-[11px] tabular-nums text-ink-soft">{fmt(gainDb)} dB</div>
      <input
        type="range"
        min={MIN_DB}
        max={MAX_DB}
        step={0.1}
        value={gainDb}
        onChange={(e) => onGain(Number(e.target.value))}
        onDoubleClick={onGainReset}
        aria-label={`${title} level`}
        className="fader accent-ink"
      />
      {children}
    </div>
  )
}
