/**
 * Turns a drop or a folder-picker selection into a sorted list of WAV files.
 * Directories are walked recursively via the (widely supported) webkitGetAsEntry API.
 */

export interface IngestFile {
  file: File
  /** Path relative to the dropped root, e.g. "Take 3/Kick In.wav". */
  path: string
}

export interface IngestResult {
  /** Take name: the dropped folder's name when there is exactly one. */
  name: string
  files: IngestFile[]
  /** Non-WAV files that were ignored. */
  skipped: number
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function isWavName(name: string): boolean {
  return /\.wav$/i.test(name) && !name.startsWith('.')
}

const basename = (path: string) => path.split('/').pop() ?? path
const stripExt = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, '')

function finish(name: string, all: IngestFile[]): IngestResult {
  const files = all.filter((f) => isWavName(basename(f.path)))
  files.sort((a, b) => natural.compare(a.path, b.path))
  return { name, files, skipped: all.length - files.length }
}

/** Shared first path segment when every file lives under the same folder. */
function commonRoot(paths: string[]): string | null {
  if (paths.length === 0) return null
  const roots = paths.map((p) => p.split('/'))
  if (roots.some((r) => r.length < 2)) return null
  const first = roots[0][0]
  return roots.every((r) => r[0] === first) ? first : null
}

export function ingestFileList(list: FileList | File[]): IngestResult {
  const files = Array.from(list)
  const paths = files.map((f) => f.webkitRelativePath || f.name)
  const name = commonRoot(paths) ?? (files.length === 1 ? stripExt(files[0].name) : 'Untitled take')
  return finish(
    name,
    files.map((file, i) => ({ file, path: paths[i] })),
  )
}

async function walk(entry: FileSystemEntry, prefix: string, out: IngestFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ file, path: prefix + entry.name })
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) break
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out)
    }
  }
}

/**
 * Must be called synchronously from the drop handler: DataTransfer entries
 * are only readable during the event.
 */
export async function ingestDataTransfer(dt: DataTransfer): Promise<IngestResult> {
  const items = Array.from(dt.items ?? [])
  const entries = items
    .filter((i) => i.kind === 'file')
    .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
  const fallback = Array.from(dt.files ?? [])

  if (entries.length > 0 && entries.every((e): e is FileSystemEntry => e !== null)) {
    const all: IngestFile[] = []
    for (const e of entries) await walk(e, '', all)
    const dirs = entries.filter((e) => e.isDirectory)
    const name = dirs.length === 1 ? dirs[0].name : entries.length === 1 ? stripExt(entries[0].name) : 'Dropped files'
    return finish(name, all)
  }
  return ingestFileList(fallback)
}
