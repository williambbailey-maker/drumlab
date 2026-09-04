/**
 * Sum-to-stereo playback of decoded stems with instant raw/fixed A/B.
 * Web Audio is used only here; all analysis stays on Float32Arrays elsewhere.
 *
 * Each track is a lane: two BufferSources (raw and fixed) run sample-locked
 * into two gains whose balance is the A/B switch, then a mix gain
 * (mute/solo) and a StereoPanner into the master.
 */

export type Variant = 'raw' | 'fixed'

export interface EngineTrack {
  id: string
  raw: Float32Array[]
  /** Processed version; omit when nothing has been applied. */
  fixed?: Float32Array[]
  sampleRate: number
  /** -1 left … +1 right. Stereo files pass through unchanged at 0. */
  pan: number
}

export interface MixState {
  id: string
  mute: boolean
  solo: boolean
  /** Fader, dB. −Infinity silences. */
  gainDb: number
  /** −1..1 */
  pan: number
}

interface Lane {
  raw: AudioBuffer
  fixed: AudioBuffer | null
  fixedKey: Float32Array | null
  rawGain: GainNode
  fixedGain: GainNode
  mix: GainNode
  panner: StereoPannerNode
  rawSource: AudioBufferSourceNode | null
  fixedSource: AudioBufferSourceNode | null
  duration: number
}

const START_LATENCY = 0.03
const SWITCH_TC = 0.004

export class PlaybackEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lanes = new Map<string, Lane>()
  private mixState = new Map<string, MixState>()
  private variant: Variant = 'raw'
  private t0 = 0
  private offset = 0
  private _playing = false
  private gen = 0

  /** Called when playback reaches the end of the longest track. */
  onEnded: (() => void) | null = null

  get playing(): boolean {
    return this._playing
  }

  get currentVariant(): Variant {
    return this.variant
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

  private makeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer | null {
    const frames = channels[0]?.length ?? 0
    if (frames === 0) return null
    const buffer = this.ensure().createBuffer(channels.length, frames, sampleRate)
    channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i))
    return buffer
  }

  /** Replace the set of playable tracks. Existing lanes are kept; new or changed material joins mid-playback in sync. */
  setTracks(tracks: EngineTrack[]): void {
    if (tracks.length === 0 && this.lanes.size === 0) return
    const ctx = this.ensure()
    const keep = new Set(tracks.map((t) => t.id))
    for (const [id, lane] of this.lanes) {
      if (keep.has(id)) continue
      this.stopLane(lane)
      lane.panner.disconnect()
      this.lanes.delete(id)
    }
    for (const t of tracks) {
      const existing = this.lanes.get(t.id)
      if (existing) {
        existing.panner.pan.value = t.pan
        const key = t.fixed?.[0] ?? null
        if (key !== existing.fixedKey) this.replaceFixed(existing, t)
        continue
      }
      const raw = this.makeBuffer(t.raw, t.sampleRate)
      if (!raw) continue
      const rawGain = ctx.createGain()
      const fixedGain = ctx.createGain()
      const mix = ctx.createGain()
      const panner = ctx.createStereoPanner()
      panner.pan.value = t.pan
      rawGain.connect(mix)
      fixedGain.connect(mix)
      mix.connect(panner)
      panner.connect(this.master!)
      const lane: Lane = {
        raw,
        fixed: null,
        fixedKey: null,
        rawGain,
        fixedGain,
        mix,
        panner,
        rawSource: null,
        fixedSource: null,
        duration: raw.duration,
      }
      this.lanes.set(t.id, lane)
      this.replaceFixed(lane, t)
      if (this._playing) {
        const now = ctx.currentTime
        this.startLane(lane, now, this.offset + Math.max(0, now - this.t0))
      }
    }
    this.applyGains()
    if (this._playing && this.offset >= this.duration) this.finish()
  }

  private replaceFixed(lane: Lane, t: EngineTrack): void {
    if (lane.fixedSource) {
      this.stopSource(lane.fixedSource)
      lane.fixedSource = null
    }
    lane.fixed = t.fixed ? this.makeBuffer(t.fixed, t.sampleRate) : null
    lane.fixedKey = t.fixed?.[0] ?? null
    if (lane.fixed) lane.duration = Math.max(lane.raw.duration, lane.fixed.duration)
    if (this._playing && lane.fixed && this.ctx) {
      const now = this.ctx.currentTime
      lane.fixedSource = this.startSource(lane, lane.fixed, lane.fixedGain, now, this.offset + Math.max(0, now - this.t0), false)
    }
    this.applyVariantGains(lane)
  }

  setVariant(v: Variant): void {
    this.variant = v
    for (const lane of this.lanes.values()) this.applyVariantGains(lane)
  }

  setMix(states: MixState[]): void {
    this.mixState = new Map(states.map((s) => [s.id, s]))
    this.applyGains()
  }

  setMaster(db: number): void {
    if (!this.master || !this.ctx) return
    this.master.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.01)
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
    for (const lane of this.lanes.values()) this.startLane(lane, this.t0, this.offset)
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

  private startLane(lane: Lane, when: number, offset: number): void {
    lane.rawSource = this.startSource(lane, lane.raw, lane.rawGain, when, offset, true)
    lane.fixedSource = lane.fixed ? this.startSource(lane, lane.fixed, lane.fixedGain, when, offset, false) : null
  }

  private startSource(
    lane: Lane,
    buffer: AudioBuffer,
    dest: GainNode,
    when: number,
    offset: number,
    watchEnd: boolean,
  ): AudioBufferSourceNode | null {
    const ctx = this.ctx!
    if (offset >= buffer.duration) return null
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(dest)
    if (watchEnd) {
      const gen = this.gen
      src.onended = () => {
        if (gen !== this.gen || lane.rawSource !== src) return
        lane.rawSource = null
        if (this._playing && this.position >= this.duration - 0.02) this.finish()
      }
    }
    src.start(when, offset)
    return src
  }

  private stopSource(src: AudioBufferSourceNode): void {
    try {
      src.onended = null
      src.stop()
    } catch {
      /* already stopped */
    }
    src.disconnect()
  }

  private stopLane(lane: Lane): void {
    if (lane.rawSource) this.stopSource(lane.rawSource)
    if (lane.fixedSource) this.stopSource(lane.fixedSource)
    lane.rawSource = null
    lane.fixedSource = null
  }

  private stopAll(): void {
    for (const lane of this.lanes.values()) this.stopLane(lane)
  }

  private finish(): void {
    this._playing = false
    this.offset = 0
    this.gen++
    this.stopAll()
    this.onEnded?.()
  }

  private applyVariantGains(lane: Lane): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const useFixed = this.variant === 'fixed' && lane.fixed !== null
    lane.rawGain.gain.setTargetAtTime(useFixed ? 0 : 1, now, SWITCH_TC)
    lane.fixedGain.gain.setTargetAtTime(useFixed ? 1 : 0, now, SWITCH_TC)
  }

  private applyGains(): void {
    if (!this.ctx) return
    let anySolo = false
    for (const m of this.mixState.values()) if (m.solo) anySolo = true
    const now = this.ctx.currentTime
    for (const [id, lane] of this.lanes) {
      const m = this.mixState.get(id)
      const audible = !m ? true : m.mute ? false : !(anySolo && !m.solo)
      const g = audible ? dbToGain(m?.gainDb ?? 0) : 0
      lane.mix.gain.setTargetAtTime(g, now, 0.008)
      if (m) lane.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, m.pan)), now, 0.008)
    }
  }
}

function dbToGain(db: number): number {
  return db === -Infinity ? 0 : Math.pow(10, db / 20)
}
