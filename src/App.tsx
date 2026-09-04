import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PlaybackEngine } from './audio/engine'
import { DropZone } from './components/DropZone'
import { TrackList } from './components/TrackList'
import { Transport } from './components/Transport'
import { useFileDrop } from './hooks/useFileDrop'
import { decodeFile } from './lib/decoder'
import { formatRate } from './lib/format'
import type { IngestResult } from './lib/ingest'
import { panForRole, type StemRole } from './lib/roles'
import { kvGet, kvSet } from './lib/store'
import { DEFAULT_KIT, kitById, type KitProfile } from './kit/profile'
import { KitPicker } from './components/KitPicker'
import { newId, projectDuration, reducer } from './state'

const KIT_KEY = 'kit-profile-id'

export default function App() {
  const [project, dispatch] = useReducer(reducer, null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  if (!engineRef.current) engineRef.current = new PlaybackEngine()
  const engine = engineRef.current
  const [playing, setPlaying] = useState(false)
  const [positionTick, setPositionTick] = useState(0)
  const [kit, setKit] = useState<KitProfile>(DEFAULT_KIT)
  const kitRef = useRef(kit)
  kitRef.current = kit

  useEffect(() => {
    void kvGet<string>(KIT_KEY).then((id) => {
      if (id) setKit(kitById(id))
    })
  }, [])

  const chooseKit = useCallback((next: KitProfile) => {
    setKit(next)
    void kvSet(KIT_KEY, next.id)
    dispatch({ type: 'set-kit', kit: next })
  }, [])

  useEffect(() => {
    engine.onEnded = () => {
      setPlaying(false)
      setPositionTick((t) => t + 1)
    }
    return () => {
      engine.onEnded = null
    }
  }, [engine])

  const open = useCallback(
    (result: IngestResult) => {
      engine.stop()
      setPlaying(false)
      setPositionTick((t) => t + 1)
      const kit = kitRef.current
      if (result.files.length === 0) {
        dispatch({ type: 'open', name: result.name, files: [], ids: [], skipped: result.skipped, kit })
        return
      }
      const ids = result.files.map(() => newId())
      dispatch({ type: 'open', name: result.name, files: result.files, ids, skipped: result.skipped, kit })
      result.files.forEach((f, i) => {
        decodeFile(f.file).then(
          (audio) => dispatch({ type: 'decoded', id: ids[i], audio }),
          (err: unknown) =>
            dispatch({ type: 'decode-error', id: ids[i], error: err instanceof Error ? err.message : String(err) }),
        )
      })
    },
    [engine],
  )

  const { dragging, handlers } = useFileDrop(open)

  const tracks = project?.tracks ?? []
  const duration = useMemo(() => projectDuration(project), [project])
  const ready = tracks.filter((t) => t.status === 'ready' && t.audio)

  // Keep the engine's lanes in step with decoded tracks and their role-derived pans.
  const laneKey = ready.map((t) => `${t.id}:${t.role}`).join('|')
  useEffect(() => {
    engine.setTracks(
      ready.map((t) => ({ id: t.id, channels: t.audio!.channels, sampleRate: t.audio!.sampleRate, pan: panForRole(t.role) })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, laneKey])

  const mixKey = tracks.map((t) => `${t.id}:${t.mute ? 1 : 0}${t.solo ? 1 : 0}`).join('|')
  useEffect(() => {
    engine.setMix(tracks.map((t) => ({ id: t.id, mute: t.mute, solo: t.solo })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, mixKey])

  const toggle = useCallback(() => {
    if (engine.playing) {
      engine.pause()
      setPlaying(false)
    } else {
      engine.play()
      setPlaying(engine.playing)
    }
    setPositionTick((t) => t + 1)
  }, [engine])

  const stop = useCallback(() => {
    engine.stop()
    setPlaying(false)
    setPositionTick((t) => t + 1)
  }, [engine])

  const seek = useCallback(
    (seconds: number) => {
      engine.seek(seconds)
      setPositionTick((t) => t + 1)
    },
    [engine],
  )

  const onRole = useCallback((id: string, role: StemRole) => dispatch({ type: 'set-role', id, role }), [])
  const onMute = useCallback((id: string) => dispatch({ type: 'toggle-mute', id }), [])
  const onSolo = useCallback((id: string) => dispatch({ type: 'toggle-solo', id }), [])

  const close = () => {
    stop()
    dispatch({ type: 'close' })
  }

  const decoding = tracks.filter((t) => t.status === 'decoding').length
  const rates = new Set(ready.map((t) => t.audio!.sampleRate))
  const depths = new Set(ready.map((t) => (t.audio!.format === 'float' ? `${t.audio!.bitDepth}f` : `${t.audio!.bitDepth}`)))
  const summary = [
    `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`,
    rates.size === 1 ? formatRate([...rates][0]) : rates.size > 1 ? 'mixed rates' : null,
    depths.size === 1 ? `${[...depths][0].replace('f', '-bit float')}${[...depths][0].endsWith('f') ? '' : '-bit'}` : depths.size > 1 ? 'mixed depths' : null,
    decoding > 0 ? `decoding ${tracks.length - decoding}/${tracks.length}` : null,
    project && project.skipped > 0 ? `${project.skipped} non-WAV ignored` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex min-h-screen flex-col" {...handlers}>
      <header className="flex items-baseline gap-5 border-b border-rule px-8 py-4">
        <h1 className="font-display text-2xl font-medium tracking-tight">Drum lab</h1>
        {project && (
          <>
            <span className="font-display text-lg italic text-ink-soft">{project.name}</span>
            <KitPicker value={project.kit} onChange={chooseKit} compact />
            <span className={`font-mono text-xs ${rates.size > 1 ? 'text-amber' : 'text-muted'}`}>{summary}</span>
            <button
              type="button"
              onClick={close}
              className="ml-auto text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
            >
              Close take
            </button>
          </>
        )}
      </header>

      <main className="flex flex-1 flex-col">
        {project ? (
          tracks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-16 text-center">
              <p className="font-display text-xl text-ink-soft">
                No WAV files in <span className="italic">{project.name}</span>. Drop another folder.
              </p>
            </div>
          ) : (
            <TrackList
              project={project}
              engine={engine}
              playing={playing}
              duration={duration}
              positionTick={positionTick}
              onRole={onRole}
              onMute={onMute}
              onSolo={onSolo}
              onSeek={seek}
            />
          )
        ) : (
          <DropZone onOpen={open} dragging={dragging} kit={kit} onKit={chooseKit} />
        )}
      </main>

      {project && tracks.length > 0 && (
        <Transport
          engine={engine}
          playing={playing}
          duration={duration}
          ready={ready.length > 0}
          positionTick={positionTick}
          onToggle={toggle}
          onStop={stop}
        />
      )}

      {dragging && project && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center bg-paper/80">
          <div className="rounded-xl border border-dashed border-rust px-10 py-6 font-display text-2xl text-ink">
            Drop to open a new take
          </div>
        </div>
      )}
    </div>
  )
}
