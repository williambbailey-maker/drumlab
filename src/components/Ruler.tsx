import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { formatTime } from '../lib/format'

interface Props {
  duration: number
  onSeek: (fraction: number) => void
}

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]

export function Ruler({ duration, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

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

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
  }

  return (
    <div ref={ref} onClick={onClick} className="relative h-6 cursor-text select-none border-b border-rule">
      {ticks.map((t) => (
        <div
          key={t}
          className="absolute bottom-0 top-0 border-l border-rule pl-1 font-mono text-[10px] leading-6 text-muted"
          style={{ left: `${(t / duration) * 100}%` }}
        >
          {formatTime(t, step < 1 ? 1 : 0)}
        </div>
      ))}
    </div>
  )
}
