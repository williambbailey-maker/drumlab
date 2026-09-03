import { useRef, type ChangeEvent } from 'react'
import { ingestFileList, type IngestResult } from '../lib/ingest'

interface Props {
  onOpen: (result: IngestResult) => void
  dragging: boolean
}

export function DropZone({ onOpen, dragging }: Props) {
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) onOpen(ingestFileList(e.target.files))
    e.target.value = ''
  }

  return (
    <section className="flex flex-1 items-center justify-center px-8 py-16">
      <div
        className={`w-full max-w-2xl rounded-2xl border border-dashed px-10 py-16 text-center transition-colors ${
          dragging ? 'border-rust bg-surface' : 'border-rule bg-transparent'
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
