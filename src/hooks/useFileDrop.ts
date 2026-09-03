import { useCallback, useRef, useState, type DragEvent } from 'react'
import { ingestDataTransfer, type IngestResult } from '../lib/ingest'

/**
 * Drag-and-drop handlers for a container element. Tracks a `dragging` flag
 * (robust to nested enter/leave churn) and resolves dropped folders to WAVs.
 */
export function useFileDrop(onDrop: (result: IngestResult) => void) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    depth.current++
    setDragging(true)
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      // Must start synchronously: the DataTransfer is only readable during the event.
      void ingestDataTransfer(e.dataTransfer).then(onDrop)
    },
    [onDrop],
  )

  return { dragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop: handleDrop } }
}
