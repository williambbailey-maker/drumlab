/** Main-thread facade over a small pool of decode workers. */
import type { DecodeRequest, DecodeResponse, TrackAudio } from '../workers/decode.worker'

export type { TrackAudio }

export const PEAK_BUCKETS = 2048

const POOL_SIZE = Math.max(1, Math.min(4, typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 1))

interface Pending {
  resolve: (audio: TrackAudio) => void
  reject: (err: Error) => void
}

let workers: Worker[] = []
let next = 0
let seq = 0
const pending = new Map<string, Pending>()

function pool(): Worker[] {
  if (workers.length === 0) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL('../workers/decode.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<DecodeResponse>) => {
        const p = pending.get(e.data.id)
        if (!p) return
        pending.delete(e.data.id)
        if (e.data.ok) {
          const { id: _id, ok: _ok, ...audio } = e.data
          p.resolve(audio)
        } else {
          p.reject(new Error(e.data.error))
        }
      }
      w.onerror = (ev) => {
        // A crashed worker fails every request routed to it; surface the error rather than hanging.
        for (const [id, p] of pending) {
          p.reject(new Error(ev.message || 'Decode worker failed'))
          pending.delete(id)
        }
      }
      workers.push(w)
    }
  }
  return workers
}

export function decodeFile(file: File, buckets = PEAK_BUCKETS): Promise<TrackAudio> {
  const id = `d${++seq}`
  const ws = pool()
  const w = ws[next++ % ws.length]
  return new Promise<TrackAudio>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const req: DecodeRequest = { id, file, buckets }
    w.postMessage(req)
  })
}

export function disposeDecoders(): void {
  for (const w of workers) w.terminate()
  workers = []
  pending.clear()
}
