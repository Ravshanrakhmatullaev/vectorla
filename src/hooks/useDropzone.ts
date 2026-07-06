import { useState, type DragEvent } from 'react'

// TODO(backend): onFiles only ever receives a FileList for UI feedback (hover
// state, filename display) — no file content is read, uploaded, or processed
// anywhere this hook is used. Wire actual upload/vectorization here once the
// backend exists.
export function useDropzone(onFiles?: (files: FileList | null) => void) {
  const [isDragOver, setIsDragOver] = useState(false)

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function onDragLeave() {
    setIsDragOver(false)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    onFiles?.(e.dataTransfer.files)
  }

  return { isDragOver, dropzoneHandlers: { onDragOver, onDragLeave, onDrop } }
}
