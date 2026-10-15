// Zoom and pan geometry for the result viewer (components/ResultViewer.tsx).
// Pure functions, so the maths is unit-tested apart from the pointer code.
//
// A view is a zoom factor relative to "fit" (the image fitted inside the
// stage, 1×) plus the point of the image, in 0–1 image coordinates, that sits
// at the stage's center. Storing the center instead of pixel offsets keeps
// the same part of the image in view when the stage is resized.

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8

/** Zoom levels the zoom buttons step through. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8] as const

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface View {
  zoom: number
  /** Image point (0–1) at the stage's horizontal center. */
  cx: number
  /** Image point (0–1) at the stage's vertical center. */
  cy: number
}

/** Where the image is drawn, in stage pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const FIT_VIEW: View = { zoom: 1, cx: 0.5, cy: 0.5 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function clampZoom(zoom: number): number {
  return clamp(Number.isFinite(zoom) ? zoom : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM)
}

/** Largest size with the image's aspect ratio that fits in `box` less `padding` on every side. */
export function fitContain(image: Size, box: Size, padding = 0): Size {
  const width = Math.max(box.width - padding * 2, 1)
  const height = Math.max(box.height - padding * 2, 1)
  if (!(image.width > 0) || !(image.height > 0)) return { width, height }
  const scale = Math.min(width / image.width, height / image.height)
  return { width: image.width * scale, height: image.height * scale }
}

function clampAxis(center: number, imageLength: number, stageLength: number): number {
  // Smaller than the stage: centered. Larger: never pulled past its edges.
  if (imageLength <= stageLength) return 0.5
  const half = stageLength / 2 / imageLength
  return clamp(center, half, 1 - half)
}

/** Clamps the zoom to 1–8× and keeps the image covering the stage wherever it is larger than it. */
export function clampView(view: View, fit: Size, stage: Size): View {
  const zoom = clampZoom(view.zoom)
  return {
    zoom,
    cx: clampAxis(view.cx, fit.width * zoom, stage.width),
    cy: clampAxis(view.cy, fit.height * zoom, stage.height),
  }
}

export function imageRect(view: View, fit: Size, stage: Size): Rect {
  const width = fit.width * view.zoom
  const height = fit.height * view.zoom
  return { x: stage.width / 2 - view.cx * width, y: stage.height / 2 - view.cy * height, width, height }
}

/** Zooms to `zoom`, keeping the image point under stage point `at` where it is. */
export function zoomAt(view: View, zoom: number, at: Point, fit: Size, stage: Size): View {
  const before = imageRect(view, fit, stage)
  const u = (at.x - before.x) / before.width
  const v = (at.y - before.y) / before.height
  const nextZoom = clampZoom(zoom)
  const width = fit.width * nextZoom
  const height = fit.height * nextZoom
  const x = at.x - u * width
  const y = at.y - v * height
  return clampView({ zoom: nextZoom, cx: (stage.width / 2 - x) / width, cy: (stage.height / 2 - y) / height }, fit, stage)
}

/** Moves the image by (dx, dy) stage pixels. */
export function panBy(view: View, dx: number, dy: number, fit: Size, stage: Size): View {
  const rect = imageRect(view, fit, stage)
  return clampView(
    { zoom: view.zoom, cx: (stage.width / 2 - (rect.x + dx)) / rect.width, cy: (stage.height / 2 - (rect.y + dy)) / rect.height },
    fit,
    stage,
  )
}

/** The next zoom step above (direction 1) or below (-1) the current zoom. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom + 1e-3) ?? MAX_ZOOM
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const step = ZOOM_STEPS[i]!
    if (step < zoom - 1e-3) return step
  }
  return MIN_ZOOM
}

/**
 * The magnifier lens: the image drawn `factor` times larger than the current
 * view, positioned so the image point under `at` sits at the lens center.
 * Coordinates are relative to the lens's top-left corner.
 */
export function lensImageRect(rect: Rect, at: Point, lensSize: number, factor: number): Rect {
  const u = (at.x - rect.x) / rect.width
  const v = (at.y - rect.y) / rect.height
  const width = rect.width * factor
  const height = rect.height * factor
  return { x: lensSize / 2 - u * width, y: lensSize / 2 - v * height, width, height }
}

/** "1×", "1.5×" ("1,5×" in Uzbek and Russian) — the zoom factor for display. */
export function formatZoom(zoom: number, locale = 'en'): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.round(zoom * 10) / 10)}×`
}
