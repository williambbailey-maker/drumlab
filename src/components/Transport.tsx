import { useEffect, useRef } from 'react'
import type { PlaybackEngine } from '../audio/engine'
import { useAnimationFrame } from '../hooks/useAnimationFrame'
import { formatTime } from '../lib/format'

interface Props {
  engine: PlaybackEngine
  playing: boolean
  duration: number
  ready: boolean
  positionTick: number
  onToggle: () => void
  onStop: () => void
}

export function Transport({ engine, playing, duration, ready, positionTick, onToggle, onStop }: Props) {
  const timeRef = useRef<HTMLSpanElement>(null)

  useAnimationFrame(
    playing,
    () => {
      if (timeRef.current) timeRef.current.textContent = formatTime(engine.position, 2)
    },
    [positionTick],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return
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
  }, [onToggle, onStop])

  return (
    <footer className="sticky bottom-0 flex items-center gap-4 border-t border-rule bg-paper/95 px-8 py-3 backdrop-blur">
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
      <div className="font-mono text-sm tabular-nums text-ink">
        <span ref={timeRef}>{formatTime(0, 2)}</span>
        <span className="text-muted"> / {formatTime(duration, 2)}</span>
      </div>
      <div className="ml-auto font-mono text-[11px] text-muted">space play/pause · home stop · click a waveform to seek</div>
    </footer>
  )
}
