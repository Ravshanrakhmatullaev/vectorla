import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { Image as ImageIcon, PenTool, Diamond, ScanSearch, ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { useLanguage } from '@/lib/language'
import { useCompareSlider } from '@/hooks/useCompareSlider'
import { buildSvgOutline, type SvgOutline } from '@/lib/svgOutline'
import {
  FIT_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  clampView,
  fitContain,
  formatZoom,
  imageRect,
  lensImageRect,
  panBy,
  stepZoom,
  zoomAt,
  type Point,
  type Rect,
  type Size,
  type View,
} from '@/lib/zoomView'
import { clamp } from '@/utils/clamp'
import { cn } from '@/utils/cn'

/** Space around the fitted image at 1×. */
const FIT_PADDING = 16
/** Room kept free under the image for the overlay bar (its height plus its bottom offset). */
const OVERLAY_INSET = 60
/** The magnifier shows the image this many times larger than the current view. */
const LENS_FACTOR = 3
/** Source pixels are drawn as hard-edged squares once each covers this many screen pixels. */
const PIXELATED_FROM = 2
/** Keyboard pan and lens steps, in screen pixels (Shift: four times as far). */
const KEY_STEP = 24

type ViewMode = 'preview' | 'outline'

type Gesture =
  | { kind: 'split' }
  | { kind: 'pan'; last: Point }
  | { kind: 'lens' }
  | { kind: 'pinch'; startDistance: number; startMid: Point; startView: View }

interface Lens {
  /** The image point being magnified, in stage pixels. */
  at: Point
  /** Touch puts the lens above the finger instead of under it. */
  source: 'mouse' | 'touch' | 'keyboard'
}

interface ResultViewerProps {
  /** The uploaded raster image (an object URL or a same-origin path). */
  originalUrl: string
  /** The traced SVG, as an image source. */
  vectorUrl: string
  /** The same SVG's text: the Outline view reads its paths from it. */
  svgText: string
  /** Drawn over the bottom of the stage (e.g. the download bar); its controls keep their own clicks. */
  overlay?: ReactNode
}

function boxStyle(rect: Rect): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: rect.width,
    height: rect.height,
    transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
  }
}

function isViewerControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, select, textarea, [data-viewer-ui]') !== null
}

/**
 * The traced result next to its original: the compare slider, zoom up to 8×
 * (buttons, pinch, Ctrl/⌘ + wheel, keyboard), an Outline view that draws the
 * SVG's real paths and anchor points, and a magnifier that shows original
 * pixels and the vector side by side under the pointer. Both images share one
 * geometry, so every view lines up exactly.
 */
export function ResultViewer({ originalUrl, vectorUrl, svgText, overlay }: ResultViewerProps) {
  const { t, language } = useLanguage()
  const copy = t.workspace.viewer
  const hintId = useId()
  const stageRef = useRef<HTMLDivElement>(null)
  const { splitPct, setSplitPct, onHandleKeyDown } = useCompareSlider(50)
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 })
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 })
  const [view, setView] = useState<View>(FIT_VIEW)
  const [mode, setMode] = useState<ViewMode>('preview')
  const [showAnchors, setShowAnchors] = useState(true)
  const [magnifier, setMagnifier] = useState(false)
  const [lens, setLens] = useState<Lens | null>(null)
  const [outlineRequested, setOutlineRequested] = useState(false)
  const pointersRef = useRef(new Map<number, Point>())
  const gestureRef = useRef<Gesture | null>(null)

  // The SVG is parsed the first time Outline is chosen, then kept.
  const outline = useMemo<SvgOutline | null>(() => (outlineRequested ? buildSvgOutline(svgText) : null), [outlineRequested, svgText])

  useLayoutEffect(() => {
    const element = stageRef.current
    if (!element) return
    const update = () => setStage({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The image is fitted, centered and kept in bounds within the stage minus
  // the overlay bar's strip, so the bar never hides part of it at any zoom;
  // the image still runs on underneath the bar while zoomed.
  const viewport: Size = { width: stage.width, height: Math.max(stage.height - (overlay ? OVERLAY_INSET : 0), 1) }
  const fit = fitContain(natural, viewport, FIT_PADDING)
  const shown = clampView(view, fit, viewport)
  const rect = imageRect(shown, fit, viewport)
  const zoomed = shown.zoom > MIN_ZOOM + 1e-3
  const pixelated = natural.width > 0 && rect.width / natural.width >= PIXELATED_FROM
  const anchorSize = shown.zoom < 1.5 ? 2.5 : shown.zoom < 3 ? 3 : shown.zoom < 6 ? 4 : 5

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as one) zooms; a plain
  // wheel pans once zoomed in and otherwise scrolls the page as usual. A
  // native listener, since React's wheel listener is passive.
  const geometryRef = useRef({ fit, viewport, zoomed })
  useEffect(() => {
    geometryRef.current = { fit, viewport, zoomed }
  })
  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    function onWheel(event: WheelEvent) {
      const { fit: currentFit, viewport: currentStage, zoomed: isZoomed } = geometryRef.current
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? currentStage.height : 1
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const bounds = element!.getBoundingClientRect()
        const at = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        const factor = Math.exp(-clamp(event.deltaY * unit, -60, 60) * 0.005)
        setView((previous) => zoomAt(clampView(previous, currentFit, currentStage), previous.zoom * factor, at, currentFit, currentStage))
      } else if (isZoomed) {
        event.preventDefault()
        setView((previous) => panBy(clampView(previous, currentFit, currentStage), -event.deltaX * unit, -event.deltaY * unit, currentFit, currentStage))
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  function stagePoint(event: { clientX: number; clientY: number }): Point {
    const bounds = stageRef.current!.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  function setSplitAt(x: number) {
    if (stage.width > 0) setSplitPct(clamp((x / stage.width) * 100, 0, 100))
  }

  function zoomTo(zoom: number, at: Point = { x: viewport.width / 2, y: viewport.height / 2 }) {
    setView(zoomAt(shown, zoom, at, fit, viewport))
  }

  function startPinch() {
    const [a, b] = [...pointersRef.current.values()]
    if (!a || !b) return
    gestureRef.current = {
      kind: 'pinch',
      startDistance: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startView: shown,
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (isViewerControl(event.target)) return
    const point = stagePoint(event)
    pointersRef.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointersRef.current.size >= 2) {
      startPinch()
      return
    }
    const onHandle = event.target instanceof Element && event.target.closest('[data-split-handle]') !== null
    if (onHandle) {
      gestureRef.current = { kind: 'split' }
    } else if (magnifier && event.pointerType !== 'mouse') {
      gestureRef.current = { kind: 'lens' }
      setLens({ at: point, source: 'touch' })
    } else if (zoomed) {
      gestureRef.current = { kind: 'pan', last: point }
    } else if (magnifier) {
      gestureRef.current = null
    } else {
      // At 1× a press anywhere moves the slider, as it always has.
      gestureRef.current = { kind: 'split' }
      setSplitAt(point.x)
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const point = stagePoint(event)
    if (magnifier && event.pointerType === 'mouse') setLens({ at: point, source: 'mouse' })
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, point)
    const gesture = gestureRef.current
    if (!gesture) return
    switch (gesture.kind) {
      case 'split':
        setSplitAt(point.x)
        break
      case 'lens':
        setLens({ at: point, source: 'touch' })
        break
      case 'pan': {
        const dx = point.x - gesture.last.x
        const dy = point.y - gesture.last.y
        gesture.last = point
        // Functional update: several moves can arrive before the next render.
        setView((previous) => panBy(clampView(previous, fit, viewport), dx, dy, fit, viewport))
        break
      }
      case 'pinch': {
        const [a, b] = [...pointersRef.current.values()]
        if (!a || !b) break
        const distance = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const scaled = zoomAt(gesture.startView, (gesture.startView.zoom * distance) / gesture.startDistance, gesture.startMid, fit, viewport)
        setView(panBy(scaled, mid.x - gesture.startMid.x, mid.y - gesture.startMid.y, fit, viewport))
        break
      }
    }
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId)
    // Lifting one finger of a pinch ends it rather than turning it into a pan.
    if (gestureRef.current?.kind === 'pinch' || pointersRef.current.size === 0) gestureRef.current = null
  }

  function onPointerLeave(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && lens?.source === 'mouse') setLens(null)
  }

  function onStageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP
    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const arrow = arrows[event.key]
    if (event.key === '+' || event.key === '=') zoomTo(stepZoom(shown.zoom, 1))
    else if (event.key === '-' || event.key === '_') zoomTo(stepZoom(shown.zoom, -1))
    else if (event.key === '0') setView(FIT_VIEW)
    else if (event.key === 'Escape' && magnifier) toggleMagnifier()
    else if (arrow && magnifier) {
      const from = lens?.at ?? { x: viewport.width / 2, y: viewport.height / 2 }
      setLens({ at: { x: clamp(from.x + arrow.x, 0, stage.width), y: clamp(from.y + arrow.y, 0, stage.height) }, source: 'keyboard' })
    } else if (arrow && zoomed) setView(panBy(shown, -arrow.x, -arrow.y, fit, viewport))
    else return
    event.preventDefault()
  }

  function toggleMagnifier() {
    const next = !magnifier
    setMagnifier(next)
    // Shown at the center right away, so touch and keyboard users see it before moving it.
    setLens(next ? { at: { x: viewport.width / 2, y: viewport.height / 2 }, source: 'keyboard' } : null)
  }

  function chooseMode(next: ViewMode) {
    if (next === 'outline') setOutlineRequested(true)
    setMode(next)
  }

  const outlineFailed = mode === 'outline' && outlineRequested && outline === null
  const cursor = magnifier ? 'cursor-crosshair' : zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-ew-resize'
  // Touch: at 1× without the magnifier, vertical swipes still scroll the page
  // and horizontal drags move the slider; otherwise every gesture is the viewer's.
  const touchAction = !magnifier && !zoomed ? 'pan-y' : 'none'

  const vectorLayer = (layerRect: Rect, fill: boolean) =>
    mode === 'outline' ? (
      <>
        {fill && <div className="absolute inset-0 bg-[var(--bg-elevated)]" />}
        {outline && (
          <div style={boxStyle(layerRect)}>
            <OutlineArt outline={outline} showAnchors={showAnchors} anchorSize={anchorSize} />
          </div>
        )}
      </>
    ) : (
      <div style={boxStyle(layerRect)}>
        <img src={vectorUrl} alt="" draggable={false} className="block h-full w-full max-w-none" />
      </div>
    )

  let lensElement: ReactNode = null
  if (magnifier && lens && stage.width > 0 && natural.width > 0) {
    const size = Math.round(clamp(Math.min(stage.width, stage.height) * 0.5, 120, 200))
    const centerY = lens.source === 'touch' ? lens.at.y - size * 0.8 : lens.at.y
    const left = clamp(lens.at.x, size / 2, Math.max(stage.width - size / 2, size / 2)) - size / 2
    const top = clamp(centerY, size / 2, Math.max(stage.height - size / 2, size / 2)) - size / 2
    // The image point under `at` sits at the lens center, wherever the lens itself is drawn.
    const lensRect = lensImageRect(rect, lens.at, size, LENS_FACTOR)
    const lensPixelated = lensRect.width / natural.width >= PIXELATED_FROM
    lensElement = (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute overflow-hidden rounded-full border-2 border-white bg-[var(--bg-subtle)] shadow-xl ring-1 ring-black/25"
        style={{ left, top, width: size, height: size }}
      >
        <div className="absolute inset-0" style={{ clipPath: 'inset(0 50% 0 0)' }}>
          <div style={boxStyle(lensRect)}>
            <img
              src={originalUrl}
              alt=""
              draggable={false}
              className="block h-full w-full max-w-none"
              style={{ imageRendering: lensPixelated ? 'pixelated' : 'auto' }}
            />
          </div>
        </div>
        <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 50%)' }}>
          {vectorLayer(lensRect, true)}
        </div>
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]" />
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
        {/* Each label hugs the divider, where the circle is widest. */}
        <span className="absolute bottom-5 right-[calc(50%+4px)] rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">
          {copy.lensOriginal}
        </span>
        <span className="absolute bottom-5 left-[calc(50%+4px)] rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">
          {copy.lensVector}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div
        ref={stageRef}
        role="group"
        aria-label={copy.stageLabel}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={onStageKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerLeave}
        className={cn(
          'relative min-h-[280px] flex-1 select-none overflow-hidden rounded-xl bg-[var(--bg-subtle)] sm:min-h-[420px]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
          cursor,
        )}
        style={{ touchAction }}
      >
        {/* Original pixels, under everything */}
        <div className={cn('pointer-events-none', natural.width === 0 && 'opacity-0')} style={boxStyle(rect)}>
          <img
            src={originalUrl}
            alt=""
            draggable={false}
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            className="block h-full w-full max-w-none"
            style={{ imageRendering: pixelated ? 'pixelated' : 'auto' }}
          />
        </div>

        {/* Vector result (or its outline) right of the slider. The clip sits on
            an untransformed wrapper so it stays put while the image moves. */}
        <div
          className={cn('pointer-events-none absolute inset-0', natural.width === 0 && 'opacity-0')}
          style={{ clipPath: `inset(0 0 0 ${splitPct}%)` }}
        >
          {vectorLayer(rect, true)}
          {outlineFailed && (
            <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-right text-xs text-[var(--ink-muted)]">{copy.outlineUnavailable}</p>
          )}
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
          style={{ left: `${splitPct}%` }}
        />
        <div
          role="slider"
          data-split-handle=""
          tabIndex={0}
          aria-label={t.common.compareSliderLabel}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(splitPct)}
          onKeyDown={(event) => {
            onHandleKeyDown(event)
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.preventDefault()
          }}
          className="absolute top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full bg-white shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          style={{ left: `${splitPct}%` }}
        >
          <div className="flex gap-0.5">
            <div className="h-2.5 w-0.5 rounded bg-[#9a96ab]" />
            <div className="h-2.5 w-0.5 rounded bg-[#9a96ab]" />
          </div>
        </div>

        <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
          {t.hero.original}
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
          {mode === 'outline' ? copy.outline : t.hero.vectorized}
        </span>

        {lensElement}

        {overlay && (
          <div data-viewer-ui="" className="contents">
            {overlay}
          </div>
        )}
      </div>

      <div role="toolbar" aria-label={copy.toolbarLabel} className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-0.5">
            <SegmentButton pressed={mode === 'preview'} onClick={() => chooseMode('preview')}>
              <ImageIcon size={14} aria-hidden="true" />
              {copy.preview}
            </SegmentButton>
            <SegmentButton pressed={mode === 'outline'} onClick={() => chooseMode('outline')}>
              <PenTool size={14} aria-hidden="true" />
              {copy.outline}
            </SegmentButton>
          </div>
          {mode === 'outline' && (
            <ToggleButton pressed={showAnchors} onClick={() => setShowAnchors((value) => !value)}>
              <Diamond size={14} aria-hidden="true" />
              {copy.anchors}
            </ToggleButton>
          )}
          <ToggleButton pressed={magnifier} onClick={toggleMagnifier}>
            <ScanSearch size={14} aria-hidden="true" />
            {copy.magnifier}
          </ToggleButton>
        </div>
        <div className="inline-flex items-center gap-1">
          <IconButton label={copy.zoomOut} disabled={!zoomed} onClick={() => zoomTo(stepZoom(shown.zoom, -1))}>
            <ZoomOut size={16} aria-hidden="true" />
          </IconButton>
          <span aria-live="polite" className="min-w-[3rem] text-center text-xs font-semibold tabular-nums text-[var(--ink)]">
            {formatZoom(shown.zoom, language)}
          </span>
          <IconButton label={copy.zoomIn} disabled={shown.zoom >= MAX_ZOOM - 1e-3} onClick={() => zoomTo(stepZoom(shown.zoom, 1))}>
            <ZoomIn size={16} aria-hidden="true" />
          </IconButton>
          <IconButton label={copy.zoomFit} disabled={!zoomed} onClick={() => setView(FIT_VIEW)}>
            <Maximize size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <p id={hintId} className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
        {magnifier ? copy.magnifierHint : copy.hint}
        <span className="sr-only"> {copy.keyboardHint}</span>
      </p>
      {mode === 'outline' && outline && (
        <p className="mt-0.5 text-[11px] font-medium text-[var(--ink-muted)]">
          {copy.outlineStats
            .replace('{shapes}', outline.shapes.length.toLocaleString(language))
            .replace('{anchors}', outline.anchorCount.toLocaleString(language))}
        </p>
      )}
    </div>
  )
}

/**
 * The SVG's own path geometry as 1 px outlines, with each anchor point as a
 * small square. Strokes don't scale with zoom, so lines stay hairlines and
 * anchors stay the same size at 8×. Memoized: zooming and panning only move
 * its box.
 */
const OutlineArt = memo(function OutlineArt({ outline, showAnchors, anchorSize }: { outline: SvgOutline; showAnchors: boolean; anchorSize: number }) {
  const { x, y, width, height } = outline.viewBox
  return (
    <svg
      viewBox={`${x} ${y} ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className="block h-full w-full overflow-visible"
    >
      <g fill="none" strokeWidth={1} strokeLinejoin="round" style={{ stroke: 'var(--ink)', strokeOpacity: 0.78 }}>
        {outline.shapes.map((shape, index) => (
          <path key={index} d={shape.d} transform={shape.transform} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      {showAnchors && (
        <g fill="none" strokeWidth={anchorSize} strokeLinecap="square" style={{ stroke: 'var(--accent)' }}>
          {outline.anchors.map((group, index) => (
            <path key={index} d={group.d} transform={group.transform} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      )}
    </svg>
  )
})

function SegmentButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        pressed ? 'bg-[var(--bg-elevated)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]',
      )}
    >
      {children}
    </button>
  )
}

function ToggleButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        pressed
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--ink-muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink)]',
      )}
    >
      {children}
    </button>
  )
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink-muted)] transition-colors',
        'hover:border-[var(--border-strong)] hover:text-[var(--ink)] disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
      )}
    >
      {children}
    </button>
  )
}
