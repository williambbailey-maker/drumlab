import type { Fix } from './types'

/**
 * Applies fixes to a full-length raw signal, in the order given (callers pass
 * them in pipeline order). Never mutates the input.
 */
export function renderFixed(raw: Float32Array, fixes: readonly Fix[]): Float32Array {
  let out = raw
  for (const fix of fixes) out = applyFix(out, fix)
  return out === raw ? new Float32Array(raw) : out
}

export function applyFix(x: Float32Array, fix: Fix): Float32Array {
  switch (fix.kind) {
    case 'pad': {
      if (fix.length === x.length) return x
      const out = new Float32Array(fix.length)
      out.set(x.subarray(0, Math.min(x.length, fix.length)))
      return out
    }
    case 'dc': {
      const out = new Float32Array(x.length)
      for (let i = 0; i < x.length; i++) out[i] = x[i] - fix.offset
      return out
    }
    case 'flip': {
      const out = new Float32Array(x.length)
      for (let i = 0; i < x.length; i++) out[i] = -x[i]
      return out
    }
    case 'shift': {
      // Positive delays the track (zeros in front); negative advances it. Length is preserved.
      const out = new Float32Array(x.length)
      const d = fix.samples
      if (d >= 0) out.set(x.subarray(0, Math.max(0, x.length - d)), d)
      else out.set(x.subarray(-d))
      return out
    }
  }
}
