import { STAGE_LABEL, type Finding, type Severity } from '../dsp/types'
import { CONTROL_COL, LABEL_COL } from './TrackRow'

interface Props {
  trackId: string
  findings: Finding[]
  soloed: boolean
  onApplied: (id: string, applied: boolean) => void
  onSolo: (trackId: string) => void
}

const DOT: Record<Severity, string> = {
  ok: 'bg-moss',
  info: 'bg-muted',
  warn: 'bg-amber',
  error: 'bg-rust',
}

/** Findings for one track, rendered directly under its row. */
export function FindingsRow({ trackId, findings, soloed, onApplied, onSolo }: Props) {
  return (
    <div
      className="grid border-b border-rule-soft bg-surface/60"
      style={{ gridTemplateColumns: `${LABEL_COL}px minmax(0, 1fr) ${CONTROL_COL}px` }}
    >
      <div className="py-2 pl-8 pr-4 font-display text-xs italic text-muted">findings</div>
      <ul className="py-1">
        {findings.map((f) => (
          <li key={f.id} className="flex items-start gap-3 py-1.5 pr-4">
            <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`} aria-hidden />
            <span className="w-16 shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
              {STAGE_LABEL[f.stage]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <span className="text-sm text-ink">{f.title}</span>
                <span className="font-mono text-[11px] text-ink-soft">{f.measure}</span>
              </div>
              <div className="text-xs leading-snug text-muted">{f.detail}</div>
            </div>
            {f.fix && (
              <div className="flex shrink-0 overflow-hidden rounded border border-rule font-mono text-[11px]" role="group" aria-label="Apply or bypass">
                <button
                  type="button"
                  onClick={() => onApplied(f.id, true)}
                  aria-pressed={f.applied}
                  className={`px-2 py-0.5 ${f.applied ? 'bg-moss text-paper' : 'text-ink-soft hover:bg-rule-soft'}`}
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => onApplied(f.id, false)}
                  aria-pressed={!f.applied}
                  className={`border-l border-rule px-2 py-0.5 ${!f.applied ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-rule-soft'}`}
                >
                  Bypass
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-start justify-center pt-2">
        <button
          type="button"
          onClick={() => onSolo(trackId)}
          aria-pressed={soloed}
          title="Solo this track to audition its fixes"
          className={`h-7 rounded border px-2 font-mono text-xs ${
            soloed ? 'border-amber bg-amber text-ink' : 'border-rule text-ink-soft hover:border-ink-soft'
          }`}
        >
          Solo
        </button>
      </div>
    </div>
  )
}
