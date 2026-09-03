import { useEffect, useRef } from 'react'

/** Runs `callback` once immediately, then every frame while `active`. */
export function useAnimationFrame(active: boolean, callback: () => void, deps: readonly unknown[] = []): void {
  const cbRef = useRef(callback)
  cbRef.current = callback
  useEffect(() => {
    cbRef.current()
    if (!active) return
    let raf = 0
    const loop = () => {
      cbRef.current()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps])
}
