import { useEffect, useRef } from 'react'
import type { PlaybackEngine, Variant } from '../audio/engine'
import { useAnimationFrame } from '../hooks/useAnimationFrame'
import { formatTime } from '../lib/format'
import type { Finding, Region } from '../dsp/types'
import type { AnalysisStatus } from '../state'

interface Props {
  engine: PlaybackEngine
  playing: boolean
  duration: number
  ready: boolean
  positionTick: number
  region: Region | null
  analysis: AnalysisStatus
  analysisError?: string
  findings: Finding[]
  variant: Variant
  onToggle: () => void
  onStop: () => void
  onAnalyze: () => void
  onVariant: (v: Variant) => void
  mixerOpen: boolean
  onToggleMixer: () => void
  loop: boolean
  onToggleLoop: () => void
  exportStatus: string | null
  exporting: boolean
  onExport: () => void
}

export function Transport({
  engine,
  playing,
  duration,
  ready,
  positionTick,
  region,
  analysis,
  analysisError,
  findings,
  variant,
  onToggle,
  onStop,
  onAnalyze,
  onVariant,
  mixerOpen,
  onToggleMixer,
  loop,
  onToggleLoop,
  exportStatus,
  exporting,
  onExport,
}: Props) {
  const timeRef = useRef<HTMLSpanElement>(null)

  useAnimationFrame(playing, () => {
    if (timeRef.current) timeRef.current.textContent = formatTime(engine.position, 2)
  }, [positionTick])

  const hasFixes = findings.some((f) => f.fix)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return
      if (e.code === 'KeyA' && hasFixes) {
        e.preventDefault()
        onVariant(variant === 'raw' ? 'fixed' : 'raw')
        return
      }
      if (e.code === 'KeyM') {
        e.preventDefault()
        onToggleMixer()
        return
      }
      if (e.code === 'KeyL') {
        e.preventDefault()
        onToggleLoop()
        return
      }
      // Space and Home on a focused button belong to the button.
      if (tag === 'BUTTON') return
      if (e.code === 'Space') {
        e.preventDefault()
        onToggle()
      } else if (e.code === 'Home') {
        e.preventDefault()
        onStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggle, onStop, onVariant, variant, hasFixes, onToggleMixer, onToggleLoop])

  const applied = findings.filter((f) => f.fix && f.applied).length
  const bypassed = findings.filter((f) => f.fix && !f.applied).length
  const attention = findings.filter((f) => f.severity === 'error').length
  const summary =
    analysis === 'done' || analysis === 'stale'
      ? [
          `${applied} ${applied === 1 ? 'fix' : 'fixes'} applied`,
          bypassed ? `${bypassed} bypassed` : null,
          attention ? `${attention} need${attention === 1 ? 's' : ''} attention` : null,
          analysis === 'stale' ? 'region or roles changed' : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : analysis === 'error'
        ? `analysis failed: ${analysisError ?? 'unknown error'}`
        : ''

  const analyzeLabel =
    analysis === 'running'
      ? 'Analyzing…'
      : analysis === 'done'
        ? 'Re-analyze'
        : analysis === 'stale'
          ? 'Re-analyze'
          : 'Analyze'

  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule bg-paper/95 px-8 py-3 backdrop-blur">
      <button
        type="button"
        onClick={onToggle}
        disabled={!ready}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-paper hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-30"
      >
        {playing ? (
          <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden>
            <rect x="1" y="1" width="3.5" height="12" fill="currentColor" />
            <rect x="7.5" y="1" width="3.5" height="12" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden>
            <path d="M1.5 1l10 6-10 6z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={!ready}
        aria-label="Stop"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-rule text-ink-soft hover:border-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect x="0.5" y="0.5" width="9" height="9" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onToggleLoop}
        aria-pressed={loop}
        aria-label={loop ? 'Loop on' : 'Loop off'}
        title="Loop the take (L)"
        className={`flex h-8 w-8 items-center justify-center rounded-full border ${
          loop ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft hover:border-ink-soft hover:text-ink'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 5.5h6.5a2 2 0 0 1 0 4H8" />
          <path d="M11 8.5H4.5a2 2 0 0 1 0-4H6" />
          <path d="M7 7.5l1.5 1-1.5 1" />
          <path d="M7 5.5L5.5 4.5 7 3.5" />
        </svg>
      </button>
      <div className="font-mono text-sm tabular-nums text-ink">
        <span ref={timeRef}>{formatTime(0, 2)}</span>
        <span className="text-muted"> / {formatTime(duration, 2)}</span>
      </div>

      <div className="mx-2 h-6 w-px bg-rule" aria-hidden />

      <div className="font-mono text-[11px] text-muted">
        region{' '}
        <span className="text-ink-soft">
          {region ? `${formatTime(region.start, 1)}–${formatTime(region.end, 1)}` : '—'}
        </span>
      </div>
      <button
        type="button"
        onClick={onAnalyze}
        disabled={!ready || !region || analysis === 'running'}
        className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
          analysis === 'done'
            ? 'border border-rule text-ink-soft hover:border-ink-soft hover:text-ink'
            : 'bg-rust text-paper hover:bg-rust/90'
        }`}
      >
        {analyzeLabel}
      </button>

      <div
        className={`flex overflow-hidden rounded-md border border-rule font-mono text-xs ${hasFixes ? '' : 'opacity-40'}`}
        role="group"
        aria-label="Listen to raw or fixed stems"
      >
        {(['raw', 'fixed'] as const).map((v) => (
          <button
            key={v}
            type="button"
            disabled={!hasFixes}
            onClick={() => onVariant(v)}
            aria-pressed={variant === v}
            className={`px-3 py-1.5 ${v === 'fixed' ? 'border-l border-rule' : ''} ${
              variant === v && hasFixes ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-rule-soft'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {summary && <div className={`font-mono text-[11px] ${attention ? 'text-rust' : 'text-muted'}`}>{summary}</div>}

      <button
        type="button"
        onClick={onExport}
        disabled={!(analysis === 'done' || analysis === 'stale') || exporting}
        title="Write <take>_fixed/ with the applied fixes and sheet.txt"
        className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:bg-moss/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {exporting ? 'Exporting…' : 'Export'}
      </button>
      {exportStatus && <div className="font-mono text-[11px] text-ink-soft">{exportStatus}</div>}

      <button
        type="button"
        onClick={onToggleMixer}
        aria-pressed={mixerOpen}
        className={`ml-auto rounded-md border px-3 py-1.5 font-mono text-xs ${
          mixerOpen ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft hover:border-ink-soft hover:text-ink'
        }`}
      >
        mixer
      </button>
      <div className="hidden font-mono text-[11px] text-muted 2xl:block">
        space play · home stop · l loop · a raw/fixed · m mixer
      </div>
    </footer>
  )
}
