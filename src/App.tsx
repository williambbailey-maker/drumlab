import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PlaybackEngine, type EngineTrack, type Variant } from './audio/engine'
import { DropZone } from './components/DropZone'
import { Mixer } from './components/Mixer'
import { KitPicker } from './components/KitPicker'
import { TrackList } from './components/TrackList'
import { Transport } from './components/Transport'
import { appliedTrim, fixesFor } from './dsp/analyze'
import { renderFixed } from './dsp/render'
import type { AnalysisInput, Region } from './dsp/types'
import { useFileDrop } from './hooks/useFileDrop'
import { DEFAULT_KIT, expectedLeadsMs, kitById, type KitProfile } from './kit/profile'
import { analyze, Superseded } from './lib/analyzer'
import { decodeFile } from './lib/decoder'
import { formatRate } from './lib/format'
import type { IngestResult } from './lib/ingest'
import { panForRole, type StemRole } from './lib/roles'
import { kvGet, kvSet } from './lib/store'
import { defaultRegion, newId, overridesAfter, projectDuration, reducer, type Project } from './state'

const KIT_KEY = 'kit-profile-id'

export default function App() {
  const [project, dispatch] = useReducer(reducer, null)
  const projectRef = useRef<Project | null>(project)
  projectRef.current = project

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

  useEffect(() => {
    engine.onEnded = () => {
      setPlaying(false)
      setPositionTick((t) => t + 1)
    }
    return () => {
      engine.onEnded = null
    }
  }, [engine])

  // ---- analysis -----------------------------------------------------------
  const runAnalysis = useCallback(
    (overrides?: Record<string, boolean>) => {
      const p = projectRef.current
      if (!p || !p.region) return
      const ready = p.tracks.filter((t) => t.status === 'ready' && t.audio)
      if (ready.length === 0) return
      const input: AnalysisInput = {
        tracks: ready.map((t) => ({ id: t.id, role: t.role, sampleRate: t.audio!.sampleRate, samples: t.audio!.channels[0] })),
        region: p.region,
        applied: overrides ?? p.overrides,
        expectedLeadMs: expectedLeadsMs(p.kit),
        mainsHz: p.kit.mainsHz,
      }
      dispatch({ type: 'analysis-start' })
      analyze(input).then(
        (result) => {
          if (projectRef.current !== null) dispatch({ type: 'analysis-done', findings: result.findings })
        },
        (err: unknown) => {
          if (err instanceof Superseded) return
          dispatch({ type: 'analysis-error', error: err instanceof Error ? err.message : String(err) })
        },
      )
    },
    [],
  )

  const chooseKit = useCallback((next: KitProfile) => {
    setKit(next)
    void kvSet(KIT_KEY, next.id)
    dispatch({ type: 'set-kit', kit: next })
  }, [])

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
  const decoding = tracks.filter((t) => t.status === 'decoding').length

  // Default region once the take's length is known.
  useEffect(() => {
    if (project && project.region === null && duration > 0 && decoding === 0) {
      dispatch({ type: 'set-region', region: defaultRegion(duration) })
    }
  }, [project, duration, decoding])

  const findings = project?.findings ?? []

  // Fixed (processed) audio per track, from the applied fixes.
  const fixedById = useMemo(() => {
    const out = new Map<string, Float32Array[]>()
    if (findings.length === 0) return out
    for (const t of ready) {
      const fixes = fixesFor(findings, t.id, { forPlayback: true })
      if (fixes.length === 0) continue
      out.set(t.id, [renderFixed(t.audio!.channels[0], fixes, t.audio!.sampleRate)])
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings, tracks])

  // Keep the engine's lanes in step with decoded tracks, their pans and their fixed renders.
  const laneKey = ready.map((t) => `${t.id}:${t.role}`).join('|')
  useEffect(() => {
    const lanes: EngineTrack[] = ready.map((t) => ({
      id: t.id,
      raw: t.audio!.channels,
      fixed: fixedById.get(t.id),
      sampleRate: t.audio!.sampleRate,
      pan: panForRole(t.role),
    }))
    engine.setTracks(lanes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, laneKey, fixedById])

  const mixKey = tracks.map((t) => `${t.id}:${t.mute ? 1 : 0}${t.solo ? 1 : 0}:${t.gainDb}:${t.pan ?? panForRole(t.role)}`).join('|')
  useEffect(() => {
    engine.setMix(
      tracks.map((t) => ({
        id: t.id,
        mute: t.mute,
        solo: t.solo,
        gainDb: t.gainDb <= -60 ? -Infinity : t.gainDb,
        pan: t.pan ?? panForRole(t.role),
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, mixKey])

  const masterDb = project?.masterDb ?? 0
  useEffect(() => {
    engine.setMaster(masterDb <= -60 ? -Infinity : masterDb)
  }, [engine, masterDb])

  const variant: Variant = project?.variant ?? 'raw'
  useEffect(() => {
    engine.setVariant(variant)
  }, [engine, variant])

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
  const onRegion = useCallback((region: Region) => dispatch({ type: 'set-region', region }), [])
  const onVariant = useCallback((v: Variant) => dispatch({ type: 'set-variant', variant: v }), [])
  const onApplied = useCallback(
    (id: string, applied: boolean) => {
      dispatch({ type: 'set-applied', id, applied })
      const p = projectRef.current
      // Re-measure downstream stages with this decision in force.
      if (p) runAnalysis(overridesAfter(p.overrides, p.findings, id, applied))
    },
    [runAnalysis],
  )
  const onAnalyze = useCallback(() => runAnalysis(), [runAnalysis])
  const onGain = useCallback((id: string, gainDb: number) => dispatch({ type: 'set-gain', id, gainDb }), [])
  const onPan = useCallback((id: string, pan: number | null) => dispatch({ type: 'set-pan', id, pan }), [])
  const onMaster = useCallback((db: number) => dispatch({ type: 'set-master', masterDb: db }), [])
  const onToggleMixer = useCallback(() => dispatch({ type: 'toggle-mixer' }), [])
  const onResetMixer = useCallback(() => dispatch({ type: 'reset-mixer' }), [])

  const close = () => {
    stop()
    dispatch({ type: 'close' })
  }

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
      <div className="app-bg" aria-hidden />
      <header className="flex items-baseline gap-5 border-b border-rule bg-paper/80 px-8 py-4 backdrop-blur-sm">
        <h1 className="font-display text-5xl font-medium leading-none tracking-tight">drum lab</h1>
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
            <div className="flex flex-1 items-center justify-center bg-paper/80 p-16 text-center">
              <p className="font-display text-xl text-ink-soft">
                No WAV files in <span className="italic">{project.name}</span>. Drop another folder.
              </p>
            </div>
          ) : (
            <div className="bg-paper/92">
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
                onRegion={onRegion}
                onApplied={onApplied}
                trim={appliedTrim(findings)}
              />
            </div>
          )
        ) : (
          <DropZone onOpen={open} dragging={dragging} kit={kit} onKit={chooseKit} />
        )}
      </main>

      {project && tracks.length > 0 && project.mixerOpen && (
        <div className="sticky bottom-[58px] z-10">
          <Mixer
            tracks={tracks}
            masterDb={project.masterDb}
            onGain={onGain}
            onPan={onPan}
            onMute={onMute}
            onSolo={onSolo}
            onMaster={onMaster}
            onReset={onResetMixer}
          />
        </div>
      )}

      {project && tracks.length > 0 && (
        <Transport
          engine={engine}
          playing={playing}
          duration={duration}
          ready={ready.length > 0}
          positionTick={positionTick}
          region={project.region}
          analysis={project.analysis}
          analysisError={project.analysisError}
          findings={findings}
          variant={variant}
          onToggle={toggle}
          onStop={stop}
          onAnalyze={onAnalyze}
          onVariant={onVariant}
          mixerOpen={project.mixerOpen}
          onToggleMixer={onToggleMixer}
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
