import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { formatTime } from '../lib/format'
import type { Region } from '../dsp/types'

interface Props {
  duration: number
  region: Region | null
  onSeek: (fraction: number) => void
  onRegion: (region: Region) => void
}

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
const DRAG_THRESHOLD_PX = 4

/** Time ruler. Click seeks; drag selects the analysis region. */
export function Ruler({ duration, region, onSeek, onRegion }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const drag = useRef<{ x0: number; moved: boolean } | null>(null)
  const [temp, setTempState] = useState<[number, number] | null>(null)
  // Pointer-up can arrive before React commits the last move, so keep the live value in a ref too.
  const tempRef = useRef<[number, number] | null>(null)
  const setTemp = (v: [number, number] | null) => {
    tempRef.current = v
    setTempState(v)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const step = duration > 0 && width > 0 ? (STEPS.find((s) => (s / duration) * width >= 64) ?? STEPS[STEPS.length - 1]) : 0
  const ticks: number[] = []
  if (step > 0) for (let t = 0; t < duration; t += step) ticks.push(t)

  const frac = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x0: e.clientX, moved: false }
    const f = frac(e)
    setTemp([f, f])
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.x0) > DRAG_THRESHOLD_PX) d.moved = true
    if (!d.moved) return
    const r = e.currentTarget.getBoundingClientRect()
    const f0 = Math.max(0, Math.min(1, (d.x0 - r.left) / r.width))
    const f1 = frac(e)
    setTemp([Math.min(f0, f1), Math.max(f0, f1)])
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const live = tempRef.current
    if (d.moved && live) {
      const [a, b] = live
      if (b - a > 0.005) onRegion({ start: a * duration, end: b * duration })
    } else {
      onSeek(frac(e))
    }
    setTemp(null)
  }

  const shown: [number, number] | null =
    temp ?? (region && duration > 0 ? [region.start / duration, region.end / duration] : null)

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        setTemp(null)
      }}
      className="relative h-6 cursor-crosshair select-none border-b border-rule touch-none"
      title="Click to seek · drag to set the analysis region"
    >
      {shown && (
        <div
          className="absolute bottom-0 top-0 border-x border-rust/70 bg-rust/15"
          style={{ left: `${shown[0] * 100}%`, width: `${(shown[1] - shown[0]) * 100}%` }}
        />
      )}
      {ticks.map((t) => (
        <div
          key={t}
          className="pointer-events-none absolute bottom-0 top-0 border-l border-rule pl-1 font-mono text-[10px] leading-6 text-muted"
          style={{ left: `${(t / duration) * 100}%` }}
        >
          {formatTime(t, step < 1 ? 1 : 0)}
        </div>
      ))}
    </div>
  )
}
