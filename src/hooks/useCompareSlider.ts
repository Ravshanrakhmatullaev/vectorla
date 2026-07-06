import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { clamp } from '@/utils/clamp'

const KEYBOARD_STEP = 5

/**
 * Drives a draggable before/after comparison slider: pointer-drag to scrub,
 * arrow/Home/End keys for keyboard access. Shared by Hero and WorkspacePreview,
 * which previously duplicated this logic with two slightly different pointer
 * strategies — this is the single implementation both now use.
 */
export function useCompareSlider(initialPct: number) {
  const [splitPct, setSplitPct] = useState(initialPct)
  const containerRef = useRef<HTMLDivElement>(null)

  function updateFromClientX(clientX: number) {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSplitPct(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100))
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    updateFromClientX(e.clientX)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) updateFromClientX(e.clientX)
  }

  function onHandleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') setSplitPct((v) => clamp(v - KEYBOARD_STEP, 0, 100))
    if (e.key === 'ArrowRight') setSplitPct((v) => clamp(v + KEYBOARD_STEP, 0, 100))
    if (e.key === 'Home') setSplitPct(0)
    if (e.key === 'End') setSplitPct(100)
  }

  return {
    splitPct,
    containerRef,
    containerHandlers: { onPointerDown, onPointerMove },
    onHandleKeyDown,
  }
}
