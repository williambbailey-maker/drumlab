/** Main-thread facade over the analysis worker. Only the latest request's result is delivered. */
import AnalysisWorker from '../workers/analysis.worker?worker&inline'
import type { AnalysisRequest, AnalysisResponse } from '../workers/analysis.worker'
import { analyzeTake } from '../dsp/analyze'
import type { AnalysisInput, AnalysisResult } from '../dsp/types'

let worker: Worker | null = null
let unavailable = false
let seq = 0
let pending: { seq: number; resolve: (r: AnalysisResult) => void; reject: (e: Error) => void } | null = null

function get(): Worker | null {
  if (unavailable) return null
  if (!worker) {
    try {
      worker = new AnalysisWorker()
    } catch {
      unavailable = true
      return null
    }
    worker.onmessage = (e: MessageEvent<AnalysisResponse>) => {
      if (!pending || e.data.seq !== pending.seq) return
      const p = pending
      pending = null
      if (e.data.ok) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error))
    }
    worker.onerror = (ev) => {
      if (!pending) return
      const p = pending
      pending = null
      p.reject(new Error(ev.message || 'Analysis worker failed'))
    }
  }
  return worker
}

export class Superseded extends Error {
  constructor() {
    super('superseded')
    this.name = 'Superseded'
  }
}

export function analyze(input: AnalysisInput): Promise<AnalysisResult> {
  const w = get()
  if (!w) return Promise.resolve(analyzeTake(input))
  const mySeq = ++seq
  if (pending) pending.reject(new Superseded())
  return new Promise<AnalysisResult>((resolve, reject) => {
    pending = { seq: mySeq, resolve, reject }
    const req: AnalysisRequest = { seq: mySeq, input }
    w.postMessage(req)
  })
}
