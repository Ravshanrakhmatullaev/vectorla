// Outline data for the result viewer's Outline view (see
// components/ResultViewer.tsx): the real SVG's own path geometry, drawn as
// thin strokes, plus every anchor point (segment end point) of every path.
//
// Only geometry is read from the SVG — viewBox, each path's `d` and an
// optional transform — and the viewer renders its own <path> elements from
// it, so no markup from the file is ever injected into the page.

/** The SVG's user coordinate system. */
export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

export interface OutlineShape {
  d: string
  /** The path's own plus inherited transforms, only when it has any. */
  transform?: string
}

/** Anchor squares, grouped by transform so each group draws as one <path>. */
export interface AnchorGroup {
  d: string
  transform?: string
}

export interface SvgOutline {
  viewBox: ViewBox
  shapes: OutlineShape[]
  anchors: AnchorGroup[]
  anchorCount: number
}

/** Parameters each path command takes (lowercase: relative coordinates). */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

const EPSILON = 1e-6

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57
}

function isSeparator(code: number): boolean {
  // space, tab, LF, CR, FF, comma
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 44
}

/** Reads one SVG number at `start`; null when there is none. */
function readNumber(d: string, start: number): [value: number, next: number] | null {
  const n = d.length
  let i = start
  const sign = d.charCodeAt(i)
  if (sign === 43 || sign === 45) i++ // + -
  let digits = 0
  while (i < n && isDigit(d.charCodeAt(i))) {
    i++
    digits++
  }
  if (d.charCodeAt(i) === 46) {
    // .
    i++
    while (i < n && isDigit(d.charCodeAt(i))) {
      i++
      digits++
    }
  }
  if (digits === 0) return null
  const e = d.charCodeAt(i)
  if (e === 101 || e === 69) {
    // e E — only an exponent when digits follow
    let j = i + 1
    const expSign = d.charCodeAt(j)
    if (expSign === 43 || expSign === 45) j++
    if (isDigit(d.charCodeAt(j))) {
      i = j
      while (i < n && isDigit(d.charCodeAt(i))) i++
    }
  }
  return [Number(d.slice(start, i)), i]
}

function formatCoordinate(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/**
 * Every anchor point of one path's data — the start of each subpath and the
 * end point of each segment, absolute and relative commands alike — as
 * `M x y h0` subpaths. Drawn with square line caps and a non-scaling stroke
 * (see ResultViewer.tsx), each one renders as a small square of fixed screen
 * size at any zoom. A closing segment that returns to its subpath's start and
 * zero-length segments add no extra point. Parsing stops at the first
 * malformed token, keeping the points read so far (as browsers render path
 * data up to its first error).
 */
export function anchorPathData(d: string): { data: string; count: number } {
  const points: number[] = []
  let command = ''
  let relative = false
  let arity = 0
  const args: number[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let subpathStart = 0 // index (in points) of the current subpath's first point

  const push = (x: number, y: number, isMove: boolean) => {
    const last = points.length - 2
    if (!isMove && last >= subpathStart && Math.abs(points[last]! - x) < EPSILON && Math.abs(points[last + 1]! - y) < EPSILON) return
    if (isMove) subpathStart = points.length
    points.push(x, y)
  }

  const n = d.length
  let i = 0
  while (i < n) {
    const code = d.charCodeAt(i)
    if (isSeparator(code)) {
      i++
      continue
    }
    const ch = d.charAt(i)
    const lower = ch.toLowerCase()
    if (lower !== ch.toUpperCase() && lower !== 'e') {
      // a command letter
      const commandArity = ARITY[lower]
      // unknown letter, unfinished arguments, or data that doesn't start with a moveto
      if (commandArity === undefined || args.length > 0 || (command === '' && lower !== 'm')) break
      command = lower
      relative = ch === lower
      arity = commandArity
      i++
      if (command === 'z') {
        const last = points.length - 2
        if (last > subpathStart && Math.abs(points[last]! - sx) < EPSILON && Math.abs(points[last + 1]! - sy) < EPSILON) {
          points.length = last
        }
        cx = sx
        cy = sy
      }
      continue
    }
    if (command === '' || command === 'z') break

    let value: number
    if (command === 'a' && (args.length === 3 || args.length === 4)) {
      // arc flags are single digits and may be written without separators
      if (ch !== '0' && ch !== '1') break
      value = ch === '1' ? 1 : 0
      i++
    } else {
      const read = readNumber(d, i)
      if (!read) break
      value = read[0]
      i = read[1]
    }
    args.push(value)
    if (args.length < arity) continue

    let x = cx
    let y = cy
    switch (command) {
      case 'h':
        x = relative ? cx + args[0]! : args[0]!
        break
      case 'v':
        y = relative ? cy + args[0]! : args[0]!
        break
      default: {
        // the segment's end point is always its last coordinate pair
        const ex = args[arity - 2]!
        const ey = args[arity - 1]!
        x = relative ? cx + ex : ex
        y = relative ? cy + ey : ey
      }
    }
    args.length = 0
    if (command === 'm') {
      sx = x
      sy = y
      push(x, y, true)
      // further coordinate pairs after a moveto are implicit linetos
      command = 'l'
    } else {
      push(x, y, false)
    }
    cx = x
    cy = y
  }

  const parts: string[] = []
  for (let p = 0; p < points.length; p += 2) {
    parts.push(`M${formatCoordinate(points[p]!)} ${formatCoordinate(points[p + 1]!)}h0`)
  }
  return { data: parts.join(''), count: points.length / 2 }
}

/** Parses a `viewBox` attribute; null unless it has four numbers and a positive size. */
export function parseViewBox(value: string | null | undefined): ViewBox | null {
  if (!value) return null
  const numbers = value.trim().split(/[\s,]+/).map(Number)
  if (numbers.length !== 4 || numbers.some((v) => !Number.isFinite(v))) return null
  const [x, y, width, height] = numbers as [number, number, number, number]
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function parseLength(value: string | null): number | null {
  if (!value) return null
  const match = /^\s*([0-9]*\.?[0-9]+)(px)?\s*$/.exec(value)
  if (!match) return null
  const length = Number(match[1])
  return length > 0 ? length : null
}

// Transform lists are copied onto the viewer's own elements, so only plain
// transform functions with numeric arguments are accepted.
const TRANSFORM_PATTERN = /^(\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s,.eE+-]*\)\s*,?)*\s*$/

/** The path's transforms (ancestors first); undefined for none, null when one is not usable. */
function transformChain(element: Element, root: Element): string | undefined | null {
  const transforms: string[] = []
  for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
    const transform = node.getAttribute('transform')
    if (transform && transform.trim()) {
      if (!TRANSFORM_PATTERN.test(transform)) return null
      transforms.unshift(transform.trim())
    }
  }
  return transforms.length > 0 ? transforms.join(' ') : undefined
}

/** True for paths that only define things (gradients, clip paths, markers…) instead of drawing. */
function isDefinition(element: Element, root: Element): boolean {
  for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
    const name = node.localName
    if (name === 'defs' || name === 'clipPath' || name === 'mask' || name === 'marker' || name === 'pattern' || name === 'symbol') return true
  }
  return false
}

/**
 * Reads the outline of an SVG document: its viewBox and every visible filled
 * path. Stroke-only paths (`fill="none"`, which the Vectorla engine writes
 * under shared edges to hide hairline seams between neighbouring shapes) add
 * no geometry of their own and are left out. Returns null when the text is
 * not an SVG with a usable size, or outside a browser (no DOMParser).
 */
export function buildSvgOutline(svgText: string): SvgOutline | null {
  if (typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) return null

  let viewBox = parseViewBox(root.getAttribute('viewBox'))
  if (!viewBox) {
    const width = parseLength(root.getAttribute('width'))
    const height = parseLength(root.getAttribute('height'))
    if (!width || !height) return null
    viewBox = { x: 0, y: 0, width, height }
  }

  const shapes: OutlineShape[] = []
  const anchorParts = new Map<string, string[]>()
  let anchorCount = 0
  for (const path of Array.from(root.getElementsByTagName('path'))) {
    const d = path.getAttribute('d')
    if (!d || path.getAttribute('fill')?.trim() === 'none') continue
    if (isDefinition(path, root)) continue
    const transform = transformChain(path, root)
    if (transform === null) continue
    shapes.push(transform ? { d, transform } : { d })
    const anchors = anchorPathData(d)
    if (anchors.count === 0) continue
    anchorCount += anchors.count
    const key = transform ?? ''
    const parts = anchorParts.get(key)
    if (parts) parts.push(anchors.data)
    else anchorParts.set(key, [anchors.data])
  }

  const anchors: AnchorGroup[] = []
  for (const [transform, parts] of anchorParts) {
    anchors.push(transform ? { d: parts.join(''), transform } : { d: parts.join('') })
  }
  return { viewBox, shapes, anchors, anchorCount }
}
