/**
 * Main-thread facade over a small pool of decode workers. The worker is
 * inlined into the bundle so the app also runs as a single HTML file; if the
 * host forbids blob workers, decoding falls back to the main thread.
 */
import DecodeWorker from '../workers/decode.worker?worker&inline'
import type { DecodeRequest, DecodeResponse, TrackAudio } from '../workers/decode.worker'
import { decodeWav } from './wav'
import { computePeaks, peakAbs } from './peaks'

export type { TrackAudio }

export const PEAK_BUCKETS = 2048

const POOL_SIZE = Math.max(1, Math.min(4, typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 1))

interface Pending {
  resolve: (audio: TrackAudio) => void
  reject: (err: Error) => void
}

let workers: Worker[] = []
let workersUnavailable = false
let next = 0
let seq = 0
const pending = new Map<string, Pending>()

async function decodeOnMainThread(file: File, buckets: number): Promise<TrackAudio> {
  const wav = decodeWav(await file.arrayBuffer())
  return {
    sampleRate: wav.sampleRate,
    bitDepth: wav.bitDepth,
    format: wav.format,
    length: wav.length,
    channels: wav.channels,
    peaks: wav.channels.map((c) => computePeaks(c, buckets)),
    peak: wav.channels.reduce((m, c) => Math.max(m, peakAbs(c)), 0),
  }
}

function pool(): Worker[] | null {
  if (workersUnavailable) return null
  if (workers.length === 0) {
    for (let i = 0; i < POOL_SIZE; i++) {
      let w: Worker
      try {
        w = new DecodeWorker()
      } catch {
        workersUnavailable = true
        for (const existing of workers) existing.terminate()
        workers = []
        return null
      }
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
  const ws = pool()
  if (!ws) return decodeOnMainThread(file, buckets)
  const id = `d${++seq}`
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
