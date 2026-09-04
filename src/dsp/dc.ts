export function measureDc(x: Float32Array, start: number, end: number): number {
  const s = Math.max(0, start)
  const e = Math.min(x.length, end)
  if (e <= s) return 0
  let sum = 0
  for (let i = s; i < e; i++) sum += x[i]
  return sum / (e - s)
}

export function removeDc(x: Float32Array, offset: number): Float32Array {
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i] - offset
  return out
}

export function removeDcInPlace(x: Float32Array, offset: number): void {
  for (let i = 0; i < x.length; i++) x[i] -= offset
}
