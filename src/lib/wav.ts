/**
 * Pure WAV decode / encode on ArrayBuffers. No Web Audio here: we keep the
 * file's own sample rate and bit depth, which `decodeAudioData` would throw
 * away by resampling to the context rate.
 *
 * Supports RIFF and RF64 containers, PCM 8/16/24/32-bit, IEEE float 32/64,
 * and WAVE_FORMAT_EXTENSIBLE wrapping either.
 */

export type SampleFormat = 'pcm' | 'float'

export interface DecodedWav {
  sampleRate: number
  bitDepth: number
  format: SampleFormat
  /** One Float32Array per channel, de-interleaved, in [-1, 1]. */
  channels: Float32Array[]
  /** Frames per channel. */
  length: number
}

export class WavError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WavError'
  }
}

const FORMAT_PCM = 1
const FORMAT_FLOAT = 3
const FORMAT_EXTENSIBLE = 0xfffe

function fourcc(dv: DataView, offset: number): string {
  return String.fromCharCode(
    dv.getUint8(offset),
    dv.getUint8(offset + 1),
    dv.getUint8(offset + 2),
    dv.getUint8(offset + 3),
  )
}

/** Returns a view over `bytes` with the given element alignment, copying only if misaligned. */
function aligned(buf: ArrayBuffer, offset: number, byteLength: number, align: number): ArrayBuffer | { buffer: ArrayBuffer; offset: number } {
  if (offset % align === 0) return { buffer: buf, offset }
  return buf.slice(offset, offset + byteLength)
}

export function decodeWav(buf: ArrayBuffer): DecodedWav {
  const dv = new DataView(buf)
  if (buf.byteLength < 12) throw new WavError('File is too short to be a WAV')
  const riff = fourcc(dv, 0)
  if ((riff !== 'RIFF' && riff !== 'RF64') || fourcc(dv, 8) !== 'WAVE') {
    throw new WavError('Not a RIFF/WAVE file')
  }

  let formatTag = 0
  let numChannels = 0
  let sampleRate = 0
  let blockAlign = 0
  let bitDepth = 0
  let haveFmt = false
  let dataOffset = -1
  let dataLength = 0
  let ds64DataSize: number | null = null

  let off = 12
  while (off + 8 <= buf.byteLength) {
    const id = fourcc(dv, off)
    let size = dv.getUint32(off + 4, true)
    const body = off + 8

    if (id === 'ds64' && size >= 16) {
      const lo = dv.getUint32(body + 8, true)
      const hi = dv.getUint32(body + 12, true)
      ds64DataSize = hi * 0x100000000 + lo
    } else if (id === 'fmt ') {
      if (size < 16) throw new WavError('Malformed fmt chunk')
      formatTag = dv.getUint16(body, true)
      numChannels = dv.getUint16(body + 2, true)
      sampleRate = dv.getUint32(body + 4, true)
      blockAlign = dv.getUint16(body + 12, true)
      bitDepth = dv.getUint16(body + 14, true)
      if (formatTag === FORMAT_EXTENSIBLE) {
        if (size < 26) throw new WavError('Malformed extensible fmt chunk')
        formatTag = dv.getUint16(body + 24, true)
      }
      haveFmt = true
    } else if (id === 'data') {
      dataOffset = body
      if (size === 0xffffffff && ds64DataSize !== null) size = ds64DataSize
      dataLength = Math.min(size, buf.byteLength - body)
      size = dataLength
    }

    off = body + size + (size & 1)
  }

  if (!haveFmt) throw new WavError('Missing fmt chunk')
  if (dataOffset < 0) throw new WavError('Missing data chunk')
  if (numChannels < 1) throw new WavError('No channels')
  if (sampleRate < 1) throw new WavError('Invalid sample rate')

  let format: SampleFormat
  if (formatTag === FORMAT_PCM) {
    if (![8, 16, 24, 32].includes(bitDepth)) throw new WavError(`Unsupported PCM bit depth ${bitDepth}`)
    format = 'pcm'
  } else if (formatTag === FORMAT_FLOAT) {
    if (bitDepth !== 32 && bitDepth !== 64) throw new WavError(`Unsupported float bit depth ${bitDepth}`)
    format = 'float'
  } else {
    throw new WavError(`Unsupported WAV format tag 0x${formatTag.toString(16)}`)
  }

  const bytesPerSample = bitDepth / 8
  const expectedAlign = bytesPerSample * numChannels
  if (blockAlign !== expectedAlign) blockAlign = expectedAlign
  const frames = Math.floor(dataLength / blockAlign)
  const total = frames * numChannels
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frames))

  const read = (samples: ArrayLike<number>, scale: number) => {
    for (let ch = 0; ch < numChannels; ch++) {
      const out = channels[ch]
      for (let i = 0, j = ch; i < frames; i++, j += numChannels) out[i] = samples[j] * scale
    }
  }

  if (format === 'pcm' && bitDepth === 8) {
    const u8 = new Uint8Array(buf, dataOffset, total)
    for (let ch = 0; ch < numChannels; ch++) {
      const out = channels[ch]
      for (let i = 0, j = ch; i < frames; i++, j += numChannels) out[i] = (u8[j] - 128) / 128
    }
  } else if (format === 'pcm' && bitDepth === 16) {
    const a = aligned(buf, dataOffset, total * 2, 2)
    const i16 = 'offset' in a ? new Int16Array(a.buffer, a.offset, total) : new Int16Array(a, 0, total)
    read(i16, 1 / 32768)
  } else if (format === 'pcm' && bitDepth === 24) {
    const u8 = new Uint8Array(buf, dataOffset, total * 3)
    for (let ch = 0; ch < numChannels; ch++) {
      const out = channels[ch]
      for (let i = 0, j = ch * 3; i < frames; i++, j += numChannels * 3) {
        const v = (u8[j] | (u8[j + 1] << 8) | (u8[j + 2] << 16)) << 8
        out[i] = (v >> 8) / 8388608
      }
    }
  } else if (format === 'pcm' && bitDepth === 32) {
    const a = aligned(buf, dataOffset, total * 4, 4)
    const i32 = 'offset' in a ? new Int32Array(a.buffer, a.offset, total) : new Int32Array(a, 0, total)
    read(i32, 1 / 2147483648)
  } else if (format === 'float' && bitDepth === 32) {
    const a = aligned(buf, dataOffset, total * 4, 4)
    const f32 = 'offset' in a ? new Float32Array(a.buffer, a.offset, total) : new Float32Array(a, 0, total)
    read(f32, 1)
  } else {
    const a = aligned(buf, dataOffset, total * 8, 8)
    const f64 = 'offset' in a ? new Float64Array(a.buffer, a.offset, total) : new Float64Array(a, 0, total)
    read(f64, 1)
  }

  return { sampleRate, bitDepth, format, channels, length: frames }
}

export interface EncodeOptions {
  bitDepth?: 16 | 24 | 32
  float?: boolean
}

/** Encodes de-interleaved channels as a canonical RIFF/WAVE file. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number, opts: EncodeOptions = {}): ArrayBuffer {
  const float = opts.float ?? false
  const bitDepth = float ? 32 : (opts.bitDepth ?? 24)
  const numChannels = channels.length
  const frames = channels[0]?.length ?? 0
  const bytesPerSample = bitDepth / 8
  const blockAlign = bytesPerSample * numChannels
  const dataSize = frames * blockAlign
  const buf = new ArrayBuffer(44 + dataSize)
  const dv = new DataView(buf)

  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i))
  }
  tag(0, 'RIFF')
  dv.setUint32(4, 36 + dataSize, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, float ? FORMAT_FLOAT : FORMAT_PCM, true)
  dv.setUint16(22, numChannels, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * blockAlign, true)
  dv.setUint16(32, blockAlign, true)
  dv.setUint16(34, bitDepth, true)
  tag(36, 'data')
  dv.setUint32(40, dataSize, true)

  let o = 44
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const x = channels[ch][i]
      if (float) {
        dv.setFloat32(o, x, true)
      } else {
        const v = Math.max(-1, Math.min(1, x))
        if (bitDepth === 16) {
          dv.setInt16(o, Math.round(v * 32767), true)
        } else if (bitDepth === 24) {
          const n = Math.round(v * 8388607)
          dv.setUint8(o, n & 0xff)
          dv.setUint8(o + 1, (n >> 8) & 0xff)
          dv.setUint8(o + 2, (n >> 16) & 0xff)
        } else {
          dv.setInt32(o, Math.round(v * 2147483647), true)
        }
      }
      o += bytesPerSample
    }
  }
  return buf
}
