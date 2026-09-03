import { useEffect, useRef, type MouseEvent } from 'react'
import type { Peaks } from '../lib/peaks'

interface Props {
  peaks: Peaks | null
  onSeek?: (fraction: number) => void
  className?: string
}

/** Canvas min/max waveform. Colour comes from the element's CSS `color`. */
export function Waveform({ peaks, onSeek, className = '' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const W = Math.max(1, Math.round(rect.width * dpr))
      const H = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      const g = canvas.getContext('2d')
      if (!g) return
      const color = getComputedStyle(canvas).color
      g.clearRect(0, 0, W, H)
      const mid = H / 2
      g.globalAlpha = 0.18
      g.fillStyle = color
      g.fillRect(0, Math.round(mid - dpr / 2), W, Math.max(1, Math.round(dpr)))
      g.globalAlpha = 1
      if (!peaks) return
      const B = peaks.min.length
      const cols = Math.max(1, Math.round(rect.width))
      const scale = mid * 0.92
      for (let x = 0; x < cols; x++) {
        const b0 = Math.floor((x * B) / cols)
        const b1 = Math.max(b0 + 1, Math.floor(((x + 1) * B) / cols))
        let lo = 1
        let hi = -1
        for (let b = b0; b < b1 && b < B; b++) {
          if (peaks.min[b] < lo) lo = peaks.min[b]
          if (peaks.max[b] > hi) hi = peaks.max[b]
        }
        if (hi < lo) continue
        const y0 = mid - hi * scale
        const y1 = mid - lo * scale
        g.fillRect(x * dpr, y0, dpr, Math.max(dpr, y1 - y0))
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [peaks])

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek) return
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
  }

  return <canvas ref={ref} onClick={onClick} className={`block h-full w-full ${className}`} />
}
