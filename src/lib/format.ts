/** m:ss.d style time, e.g. 1:02.4 (one decimal by default). */
export function formatTime(seconds: number, decimals = 1): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  const fixed = s.toFixed(decimals)
  const padded = s < 10 ? `0${fixed}` : fixed
  return `${m}:${padded}`
}

export function formatRate(hz: number): string {
  const k = hz / 1000
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`
}

export function formatDb(db: number): string {
  if (db === -Infinity) return '−∞'
  const s = db.toFixed(1)
  return s.startsWith('-') ? `−${s.slice(1)}` : s
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
