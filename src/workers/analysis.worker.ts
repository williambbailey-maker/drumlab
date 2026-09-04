import { analyzeTake } from '../dsp/analyze'
import type { AnalysisInput, AnalysisResult } from '../dsp/types'

export interface AnalysisRequest {
  seq: number
  input: AnalysisInput
}

export type AnalysisResponse = { seq: number; ok: true; result: AnalysisResult } | { seq: number; ok: false; error: string }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<AnalysisRequest>) => void) | null
  postMessage(msg: AnalysisResponse): void
}

scope.onmessage = (e) => {
  const { seq, input } = e.data
  try {
    scope.postMessage({ seq, ok: true, result: analyzeTake(input) })
  } catch (err) {
    scope.postMessage({ seq, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
