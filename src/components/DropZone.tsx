import { useRef, type ChangeEvent } from 'react'
import { ingestFileList, type IngestResult } from '../lib/ingest'
import { roleLabel } from '../lib/roles'
import type { KitProfile } from '../kit/profile'
import { KitPicker } from './KitPicker'

interface Props {
  onOpen: (result: IngestResult) => void
  dragging: boolean
  kit: KitProfile
  onKit: (kit: KitProfile) => void
}

export function DropZone({ onOpen, dragging, kit, onKit }: Props) {
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) onOpen(ingestFileList(e.target.files))
    e.target.value = ''
  }

  return (
    <section className="flex flex-1 items-center justify-center px-8 py-16">
      <div
        className={`w-full max-w-2xl rounded-2xl border border-dashed bg-surface/95 px-10 py-16 text-center shadow-[0_24px_60px_-20px_rgba(33,29,24,0.45)] backdrop-blur-sm transition-colors ${
          dragging ? 'border-rust' : 'border-rule'
        }`}
      >
        <h2 className="font-display text-3xl font-medium tracking-tight text-ink">Drop a folder of drum stems</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
          One WAV per mic. Roles are guessed from filenames and can be corrected per track. Nothing is uploaded
          and the originals are never touched.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => folderInput.current?.click()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-soft"
          >
            Choose folder
          </button>
          <button
            type="button"
            onClick={() => filesInput.current?.click()}
            className="rounded-md border border-rule px-4 py-2 text-sm text-ink-soft hover:border-ink-soft hover:text-ink"
          >
            Choose files
          </button>
        </div>
        <p className="mt-6 font-mono text-xs text-muted">WAV · PCM 16/24/32 or float · any sample rate</p>

        <div className="mt-10 border-t border-rule pt-6">
          <KitPicker value={kit} onChange={onKit} />
          {kit.inputs.length > 0 ? (
            <div className="mx-auto mt-4 max-w-md overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] text-ink-soft">
                <tbody>
                  {kit.inputs.map((i) => (
                    <tr key={i.input} className="border-t border-rule-soft">
                      <td className="py-1 pr-3 text-muted">{i.input}</td>
                      <td className="py-1 pr-3 font-sans text-xs font-medium text-ink">{roleLabel(i.role)}</td>
                      <td className="py-1 pr-3">{i.mic}</td>
                      <td className="py-1 text-right text-muted">lvl {i.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted">
                {kit.interface}
                {kit.mainsHz ? ` · ${kit.mainsHz} Hz mains` : ''} · applies to tracks the filename alone can't place
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">Roles are guessed from filenames only.</p>
          )}
        </div>
        <input
          ref={folderInput}
          type="file"
          className="hidden"
          onChange={onChange}
          // Non-standard but supported everywhere that matters.
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          multiple
        />
        <input ref={filesInput} type="file" className="hidden" accept=".wav,audio/wav,audio/x-wav" multiple onChange={onChange} />
      </div>
    </section>
  )
}
