/**
 * Sum-to-stereo playback of decoded stems. Web Audio is used only here;
 * all analysis stays on Float32Arrays elsewhere.
 *
 * Each track gets its own lane: BufferSource → Gain (mute/solo) → StereoPanner
 * → master. Every play() creates fresh sources started at one shared context
 * time, so tracks stay sample-locked regardless of when they were added.
 */

export interface EngineTrack {
  id: string
  channels: Float32Array[]
  sampleRate: number
  /** -1 left … +1 right. Stereo files pass through unchanged at 0. */
  pan: number
}

export interface MixState {
  id: string
  mute: boolean
  solo: boolean
}

interface Lane {
  buffer: AudioBuffer
  gain: GainNode
  panner: StereoPannerNode
  source: AudioBufferSourceNode | null
  duration: number
}

const START_LATENCY = 0.03

export class PlaybackEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lanes = new Map<string, Lane>()
  private mix = new Map<string, MixState>()
  private t0 = 0
  private offset = 0
  private _playing = false
  private gen = 0

  /** Called when playback reaches the end of the longest track. */
  onEnded: (() => void) | null = null

  get playing(): boolean {
    return this._playing
  }

  get duration(): number {
    let d = 0
    for (const lane of this.lanes.values()) d = Math.max(d, lane.duration)
    return d
  }

  get position(): number {
    if (!this._playing || !this.ctx) return this.offset
    const elapsed = Math.max(0, this.ctx.currentTime - this.t0)
    return Math.min(this.duration, this.offset + elapsed)
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
    }
    return this.ctx
  }

  /** Replace the set of playable tracks. Existing lanes are kept; new ones join mid-playback in sync. */
  setTracks(tracks: EngineTrack[]): void {
    if (tracks.length === 0 && this.lanes.size === 0) return
    const ctx = this.ensure()
    const keep = new Set(tracks.map((t) => t.id))
    for (const [id, lane] of this.lanes) {
      if (keep.has(id)) continue
      this.stopSource(lane)
      lane.gain.disconnect()
      lane.panner.disconnect()
      this.lanes.delete(id)
    }
    for (const t of tracks) {
      const existing = this.lanes.get(t.id)
      if (existing) {
        existing.panner.pan.value = t.pan
        continue
      }
      const frames = t.channels[0]?.length ?? 0
      if (frames === 0 || t.channels.length === 0) continue
      const buffer = ctx.createBuffer(t.channels.length, frames, t.sampleRate)
      t.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i))
      const gain = ctx.createGain()
      const panner = ctx.createStereoPanner()
      panner.pan.value = t.pan
      gain.connect(panner)
      panner.connect(this.master!)
      const lane: Lane = { buffer, gain, panner, source: null, duration: buffer.duration }
      this.lanes.set(t.id, lane)
      if (this._playing) {
        const now = ctx.currentTime
        this.startSource(lane, now, this.offset + Math.max(0, now - this.t0))
      }
    }
    this.applyGains()
    if (this._playing && this.offset >= this.duration) this.finish()
  }

  setMix(states: MixState[]): void {
    this.mix = new Map(states.map((s) => [s.id, s]))
    this.applyGains()
  }

  play(from?: number): void {
    if (this.lanes.size === 0) return
    const ctx = this.ensure()
    if (ctx.state !== 'running') void ctx.resume()
    if (this._playing) {
      this.gen++
      this.stopAll()
    }
    let off = from ?? this.offset
    if (off >= this.duration - 1e-3) off = 0
    this.offset = Math.max(0, off)
    this.gen++
    this.t0 = ctx.currentTime + START_LATENCY
    this._playing = true
    for (const lane of this.lanes.values()) this.startSource(lane, this.t0, this.offset)
  }

  pause(): void {
    if (!this._playing) return
    this.offset = this.position
    this._playing = false
    this.gen++
    this.stopAll()
  }

  stop(): void {
    this.pause()
    this.offset = 0
  }

  seek(seconds: number): void {
    const target = Math.max(0, Math.min(this.duration, seconds))
    if (this._playing) this.play(target)
    else this.offset = target
  }

  dispose(): void {
    this.gen++
    this.stopAll()
    this.lanes.clear()
    void this.ctx?.close()
    this.ctx = null
    this.master = null
  }

  private startSource(lane: Lane, when: number, offset: number): void {
    const ctx = this.ctx!
    if (offset >= lane.duration) return
    const src = ctx.createBufferSource()
    src.buffer = lane.buffer
    src.connect(lane.gain)
    const gen = this.gen
    src.onended = () => {
      if (gen !== this.gen || lane.source !== src) return
      lane.source = null
      if (this._playing && this.position >= this.duration - 0.02) this.finish()
    }
    src.start(when, offset)
    lane.source = src
  }

  private stopSource(lane: Lane): void {
    if (!lane.source) return
    try {
      lane.source.onended = null
      lane.source.stop()
    } catch {
      /* already stopped */
    }
    lane.source.disconnect()
    lane.source = null
  }

  private stopAll(): void {
    for (const lane of this.lanes.values()) this.stopSource(lane)
  }

  private finish(): void {
    this._playing = false
    this.offset = 0
    this.gen++
    this.stopAll()
    this.onEnded?.()
  }

  private applyGains(): void {
    if (!this.ctx) return
    let anySolo = false
    for (const m of this.mix.values()) if (m.solo) anySolo = true
    const now = this.ctx.currentTime
    for (const [id, lane] of this.lanes) {
      const m = this.mix.get(id)
      const g = !m ? 1 : m.mute ? 0 : anySolo && !m.solo ? 0 : 1
      lane.gain.gain.setTargetAtTime(g, now, 0.008)
    }
  }
}
