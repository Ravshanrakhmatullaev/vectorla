import { useState, type KeyboardEvent, type PointerEvent } from 'react'
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

  // Measures the element the handlers are attached to (the event's
  // currentTarget). A shared container ref broke dragging once a component
  // swapped which element held it (WorkspacePreview: demo -> real result).
  function updateFromClientX(el: Element, clientX: number) {
    const rect = el.getBoundingClientRect()
    setSplitPct(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100))
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    // Controls inside the slider (e.g. the Download button) must keep their
    // clicks: capturing the pointer would retarget the click to the container.
    if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea')) return
    updateFromClientX(e.currentTarget, e.clientX)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) updateFromClientX(e.currentTarget, e.clientX)
  }

  function onHandleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') setSplitPct((v) => clamp(v - KEYBOARD_STEP, 0, 100))
    if (e.key === 'ArrowRight') setSplitPct((v) => clamp(v + KEYBOARD_STEP, 0, 100))
    if (e.key === 'Home') setSplitPct(0)
    if (e.key === 'End') setSplitPct(100)
  }

  return {
    splitPct,
    containerHandlers: { onPointerDown, onPointerMove },
    onHandleKeyDown,
  }
}
