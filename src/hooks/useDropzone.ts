import { useState, type DragEvent } from 'react'

// Hero.tsx doesn't pass onFiles — its dropzone is decorative only. See
// WorkspacePreview.tsx for the real upload wiring (src/hooks/useUploadFlow.ts).
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
