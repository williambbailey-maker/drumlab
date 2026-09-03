import { decodeWav } from '../lib/wav'
import { computePeaks, peakAbs, type Peaks } from '../lib/peaks'
import type { SampleFormat } from '../lib/wav'

export interface DecodeRequest {
  id: string
  file: File
  buckets: number
}

export interface TrackAudio {
  sampleRate: number
  bitDepth: number
  format: SampleFormat
  length: number
  channels: Float32Array[]
  peaks: Peaks[]
  /** Absolute sample peak across all channels, linear. */
  peak: number
}

export type DecodeResponse = ({ id: string; ok: true } & TrackAudio) | { id: string; ok: false; error: string }

// The app tsconfig uses the DOM lib, so type the worker scope by hand.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DecodeRequest>) => void) | null
  postMessage(msg: DecodeResponse, transfer?: Transferable[]): void
}

scope.onmessage = async (e) => {
  const { id, file, buckets } = e.data
  try {
    const buf = await file.arrayBuffer()
    const wav = decodeWav(buf)
    const peaks = wav.channels.map((c) => computePeaks(c, buckets))
    const peak = wav.channels.reduce((m, c) => Math.max(m, peakAbs(c)), 0)
    const transfer: Transferable[] = [
      ...wav.channels.map((c) => c.buffer),
      ...peaks.flatMap((p) => [p.min.buffer, p.max.buffer]),
    ]
    scope.postMessage(
      {
        id,
        ok: true,
        sampleRate: wav.sampleRate,
        bitDepth: wav.bitDepth,
        format: wav.format,
        length: wav.length,
        channels: wav.channels,
        peaks,
        peak,
      },
      transfer,
    )
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
