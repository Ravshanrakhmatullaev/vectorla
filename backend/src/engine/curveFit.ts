/**
 * Curve fitting for boundary chains — Potrace's algorithm (Selinger, 2003),
 * generalized from closed single-color outlines to the open, shared chains of
 * a multi-color planar map.
 *
 *  1. Straight-subpath detection on the pixel-crack lattice path ("lon"):
 *     digital straight-segment theory, so a staircase of any slope reads as
 *     one straight line rather than a zig-zag.
 *  2. Optimal polygon: fewest vertices, then least squared deviation.
 *  3. Vertex adjustment: each vertex moves (within its pixel) to the
 *     intersection of the best-fit lines of its two edges — sub-pixel
 *     accurate corners.
 *  4. Smoothing: each vertex becomes a sharp corner or a Bézier curve
 *     depending on how much it deviates from its neighbours (alphamax).
 *  5. Curve optimization: consecutive curves bending the same way are joined
 *     into single Béziers within a tolerance — fewer nodes, smoother shapes.
 *
 * Open chains keep their endpoints fixed exactly on the lattice so the chains
 * meeting at a junction stay connected.
 */

export type Segment =
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }

export interface FittedChain {
  startX: number
  startY: number
  segments: Segment[]
}

export interface FitOptions {
  /** Corner threshold (Potrace alphamax): lower = more corners, higher = smoother. */
  alphaMax: number
  /** Curve-merge tolerance in working pixels (Potrace opttolerance); 0 disables merging. */
  optTolerance: number
  /** Restores sharp corners rounded off by anti-aliasing/resampling; null disables. */
  cornerSnap: CornerSnapOptions | null
}

export interface CornerSnapOptions {
  /** Polygon edges at least this long (working px) can anchor a corner. */
  minLineLength: number
  /** Max total length (working px) of the short edges collapsed into the corner. */
  maxCornerSpan: number
  /** Minimum turn between the two anchoring edges, in degrees. */
  minTurnDegrees: number
}

interface Pt {
  x: number
  y: number
}

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0)
const mod = (a: number, n: number) => (a >= n ? a % n : a >= 0 ? a : n - 1 - ((-1 - a) % n))
const xprod = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx
const cyclic = (a: number, b: number, c: number) => (a <= c ? a <= b && b < c : a <= b || b < c)
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
const dpara = (p0: Pt, p1: Pt, p2: Pt) => (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
const cprod = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => (p1.x - p0.x) * (p3.y - p2.y) - (p3.x - p2.x) * (p1.y - p0.y)
const iprod = (p0: Pt, p1: Pt, p2: Pt) => (p1.x - p0.x) * (p2.x - p0.x) + (p1.y - p0.y) * (p2.y - p0.y)
const iprod1 = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => (p1.x - p0.x) * (p3.x - p2.x) + (p1.y - p0.y) * (p3.y - p2.y)
const ddist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y)

function ddenom(p0: Pt, p2: Pt): number {
  const rx = sign(p2.x - p0.x)
  const ry = -sign(p2.y - p0.y)
  return ry * (p2.x - p0.x) - rx * (p2.y - p0.y)
}

function bezierPoint(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const s = 1 - t
  return {
    x: s * s * s * p0.x + 3 * (s * s * t) * p1.x + 3 * (t * t * s) * p2.x + t * t * t * p3.x,
    y: s * s * s * p0.y + 3 * (s * s * t) * p1.y + 3 * (t * t * s) * p2.y + t * t * t * p3.y,
  }
}

function tangentParam(p0: Pt, p1: Pt, p2: Pt, p3: Pt, q0: Pt, q1: Pt): number {
  const A = cprod(p0, p1, q0, q1)
  const B = cprod(p1, p2, q0, q1)
  const C = cprod(p2, p3, q0, q1)
  const a = A - 2 * B + C
  const b = -2 * A + 2 * B
  const c = A
  const d = b * b - 4 * a * c
  if (a === 0 || d < 0) return -1
  const s = Math.sqrt(d)
  const r1 = (-b + s) / (2 * a)
  const r2 = (-b - s) / (2 * a)
  if (r1 >= 0 && r1 <= 1) return r1
  if (r2 >= 0 && r2 <= 1) return r2
  return -1
}

/** Lattice path + prefix sums, shared by every stage. */
class LatticePath {
  readonly n: number
  readonly x: Int32Array
  readonly y: Int32Array
  readonly x0: number
  readonly y0: number
  // Prefix sums of (x, y, xy, x2, y2) relative to (x0, y0); length n + 1.
  readonly sx: Float64Array
  readonly sy: Float64Array
  readonly sxy: Float64Array
  readonly sx2: Float64Array
  readonly sy2: Float64Array

  constructor(
    points: Int32Array,
    count: number,
    readonly closed: boolean,
  ) {
    this.n = count
    this.x = new Int32Array(count)
    this.y = new Int32Array(count)
    for (let i = 0; i < count; i++) {
      this.x[i] = points[i * 2]!
      this.y[i] = points[i * 2 + 1]!
    }
    this.x0 = this.x[0]!
    this.y0 = this.y[0]!
    this.sx = new Float64Array(count + 1)
    this.sy = new Float64Array(count + 1)
    this.sxy = new Float64Array(count + 1)
    this.sx2 = new Float64Array(count + 1)
    this.sy2 = new Float64Array(count + 1)
    for (let i = 0; i < count; i++) {
      const x = this.x[i]! - this.x0
      const y = this.y[i]! - this.y0
      this.sx[i + 1] = this.sx[i]! + x
      this.sy[i + 1] = this.sy[i]! + y
      this.sxy[i + 1] = this.sxy[i]! + x * y
      this.sx2[i + 1] = this.sx2[i]! + x * x
      this.sy2[i + 1] = this.sy2[i]! + y * y
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 1: straight subpaths
// ---------------------------------------------------------------------------

/**
 * For each i, pivk[i] is the furthest k such that the subpath i..k is
 * "straight" (Potrace calc_lon); returns lon[] after monotone clean-up.
 */
function calcLon(path: LatticePath): Int32Array {
  const { n, x: px, y: py, closed } = path
  const pivk = new Int32Array(n)
  const nc = new Int32Array(n)
  const lon = new Int32Array(n)
  const ct = [0, 0, 0, 0]

  let k = closed ? 0 : n - 1
  for (let i = n - 1; i >= 0; i--) {
    if (px[i] !== px[k] && py[i] !== py[k]) k = i + 1
    nc[i] = k
  }

  for (let i = n - 1; i >= 0; i--) {
    if (!closed && i === n - 1) {
      pivk[i] = n - 1
      continue
    }
    ct[0] = ct[1] = ct[2] = ct[3] = 0
    const i1 = closed ? mod(i + 1, n) : i + 1
    let dir = (3 + 3 * (px[i1]! - px[i]!) + (py[i1]! - py[i]!)) >> 1
    ct[dir]!++
    let c0x = 0
    let c0y = 0
    let c1x = 0
    let c1y = 0
    k = nc[i]!
    let k1 = i
    let found = false
    let reachedEnd = false
    for (;;) {
      dir = (3 + 3 * sign(px[k]! - px[k1]!) + sign(py[k]! - py[k1]!)) >> 1
      ct[dir]!++
      if (ct[0] && ct[1] && ct[2] && ct[3]) {
        pivk[i] = k1
        found = true
        break
      }
      const curx = px[k]! - px[i]!
      const cury = py[k]! - py[i]!
      if (xprod(c0x, c0y, curx, cury) < 0 || xprod(c1x, c1y, curx, cury) > 0) break
      if (Math.abs(curx) > 1 || Math.abs(cury) > 1) {
        let offx = curx + (cury >= 0 && (cury > 0 || curx < 0) ? 1 : -1)
        let offy = cury + (curx <= 0 && (curx < 0 || cury < 0) ? 1 : -1)
        if (xprod(c0x, c0y, offx, offy) >= 0) {
          c0x = offx
          c0y = offy
        }
        offx = curx + (cury <= 0 && (cury < 0 || curx < 0) ? 1 : -1)
        offy = cury + (curx >= 0 && (curx > 0 || cury < 0) ? 1 : -1)
        if (xprod(c1x, c1y, offx, offy) <= 0) {
          c1x = offx
          c1y = offy
        }
      }
      k1 = k
      if (!closed && k1 === n - 1) {
        reachedEnd = true
        break
      }
      k = nc[k1]!
      if (closed ? !cyclic(k, i, k1) : false) break
    }
    if (found) continue
    if (reachedEnd) {
      pivk[i] = n - 1
      continue
    }
    const dkx = sign(px[k]! - px[k1]!)
    const dky = sign(py[k]! - py[k1]!)
    const curx = px[k1]! - px[i]!
    const cury = py[k1]! - py[i]!
    const a = xprod(c0x, c0y, curx, cury)
    const b = xprod(c0x, c0y, dkx, dky)
    const c = xprod(c1x, c1y, curx, cury)
    const d = xprod(c1x, c1y, dkx, dky)
    let j = 10_000_000
    if (b < 0) j = Math.floor(a / -b)
    if (d > 0) j = Math.min(j, Math.floor(-c / d))
    pivk[i] = closed ? mod(k1 + j, n) : Math.min(n - 1, k1 + j)
  }

  if (closed) {
    let j = pivk[n - 1]!
    lon[n - 1] = j
    for (let i = n - 2; i >= 0; i--) {
      if (cyclic(i + 1, pivk[i]!, j)) j = pivk[i]!
      lon[i] = j
    }
    for (let i = n - 1; cyclic(mod(i + 1, n), j, lon[i]!); i--) lon[i] = j
  } else {
    let j = pivk[n - 1]!
    lon[n - 1] = j
    for (let i = n - 2; i >= 0; i--) {
      if (pivk[i]! < j) j = pivk[i]!
      lon[i] = j
    }
  }
  return lon
}

// ---------------------------------------------------------------------------
// Stage 2: optimal polygon
// ---------------------------------------------------------------------------

/** Potrace penalty3: RMS distance of path points i..j from the segment i->j (j may wrap for closed paths). */
function penalty3(path: LatticePath, i: number, jIn: number): number {
  const n = path.n
  let j = jIn
  let r = 0
  if (j >= n) {
    j -= n
    r = 1
  }
  let x: number
  let y: number
  let x2: number
  let xy: number
  let y2: number
  let k: number
  if (r === 0) {
    x = path.sx[j + 1]! - path.sx[i]!
    y = path.sy[j + 1]! - path.sy[i]!
    x2 = path.sx2[j + 1]! - path.sx2[i]!
    xy = path.sxy[j + 1]! - path.sxy[i]!
    y2 = path.sy2[j + 1]! - path.sy2[i]!
    k = j + 1 - i
  } else {
    x = path.sx[j + 1]! - path.sx[i]! + path.sx[n]!
    y = path.sy[j + 1]! - path.sy[i]! + path.sy[n]!
    x2 = path.sx2[j + 1]! - path.sx2[i]! + path.sx2[n]!
    xy = path.sxy[j + 1]! - path.sxy[i]! + path.sxy[n]!
    y2 = path.sy2[j + 1]! - path.sy2[i]! + path.sy2[n]!
    k = j + 1 - i + n
  }
  const px = (path.x[i]! + path.x[j]!) / 2 - path.x0
  const py = (path.y[i]! + path.y[j]!) / 2 - path.y0
  const ey = path.x[j]! - path.x[i]!
  const ex = -(path.y[j]! - path.y[i]!)
  const a = (x2 - 2 * x * px) / k + px * px
  const b = (xy - x * py - y * px) / k + px * py
  const c = (y2 - 2 * y * py) / k + py * py
  const s = ex * ex * a + 2 * ex * ey * b + ey * ey * c
  return Math.sqrt(Math.max(0, s))
}

function bestPolygonClosed(path: LatticePath, lon: Int32Array): number[] {
  const n = path.n
  const pen = new Float64Array(n + 1)
  const prev = new Int32Array(n + 1)
  const clip0 = new Int32Array(n)
  const clip1 = new Int32Array(n + 1)
  const seg0 = new Int32Array(n + 1)
  const seg1 = new Int32Array(n + 1)

  for (let i = 0; i < n; i++) {
    let c = mod(lon[mod(i - 1, n)]! - 1, n)
    if (c === i) c = mod(i + 1, n)
    clip0[i] = c < i ? n : c
  }
  let j = 1
  for (let i = 0; i < n; i++) {
    while (j <= clip0[i]!) {
      clip1[j] = i
      j++
    }
  }
  let i = 0
  for (j = 0; i < n; j++) {
    seg0[j] = i
    i = clip0[i]!
  }
  seg0[j] = n
  const m = j
  i = n
  for (j = m; j > 0; j--) {
    seg1[j] = i
    i = clip1[i]!
  }
  seg1[0] = 0
  pen[0] = 0
  for (j = 1; j <= m; j++) {
    for (i = seg1[j]!; i <= seg0[j]!; i++) {
      let best = -1
      for (let k = seg0[j - 1]!; k >= clip1[i]!; k--) {
        const thispen = penalty3(path, k, i) + pen[k]!
        if (best < 0 || thispen < best) {
          prev[i] = k
          best = thispen
        }
      }
      pen[i] = best
    }
  }
  const po = new Array<number>(m)
  for (i = n, j = m - 1; i > 0; j--) {
    i = prev[i]!
    po[j] = i
  }
  return po
}

/**
 * Open-chain variant: vertices 0 and n-1 are mandatory. A segment (i, j) is
 * allowed when the subpath one point beyond each end is straight (Potrace's
 * condition), relaxed at the fixed chain ends where no extension exists.
 */
function bestPolygonOpen(path: LatticePath, lon: Int32Array): number[] {
  const n = path.n
  if (n <= 2) return n === 2 ? [0, 1] : [0]
  const last = n - 1
  const clip0 = new Int32Array(n)
  for (let i = 0; i < last; i++) {
    const ext = i === 0 ? lon[0]! : lon[i - 1]!
    let c = ext >= last ? last : ext - 1
    if (c <= i) c = i + 1
    clip0[i] = c
  }
  // clip1[j] = smallest i whose segment can reach j (clip0 is non-decreasing).
  const clip1 = new Int32Array(n)
  let i = 0
  for (let j = 1; j < n; j++) {
    while (clip0[i]! < j) i++
    clip1[j] = i
  }
  const count = new Int32Array(n)
  const pen = new Float64Array(n)
  const prev = new Int32Array(n)
  count[0] = 0
  pen[0] = 0
  for (let j = 1; j < n; j++) {
    let bestCount = Infinity
    let bestPen = Infinity
    let bestPrev = j - 1
    for (let k = j - 1; k >= clip1[j]!; k--) {
      if (clip0[k]! < j) continue
      const c = count[k]! + 1
      if (c > bestCount) continue
      const p = pen[k]! + penalty3(path, k, j)
      if (c < bestCount || p < bestPen) {
        bestCount = c
        bestPen = p
        bestPrev = k
      }
    }
    count[j] = bestCount === Infinity ? count[j - 1]! + 1 : bestCount
    pen[j] = bestPen === Infinity ? pen[j - 1]! : bestPen
    prev[j] = bestPrev
  }
  const po: number[] = []
  for (let j = last; j > 0; j = prev[j]!) po.push(j)
  po.push(0)
  return po.reverse()
}

// ---------------------------------------------------------------------------
// Stage 3: vertex adjustment
// ---------------------------------------------------------------------------

/** Best-fit line (center + direction) through path points i..j (Potrace pointslope). */
function pointSlope(path: LatticePath, iIn: number, jIn: number): { cx: number; cy: number; dx: number; dy: number } {
  const n = path.n
  let i = iIn
  let j = jIn
  let r = 0
  while (j >= n) {
    j -= n
    r += 1
  }
  while (i >= n) {
    i -= n
    r -= 1
  }
  while (j < 0) {
    j += n
    r -= 1
  }
  while (i < 0) {
    i += n
    r += 1
  }
  const x = path.sx[j + 1]! - path.sx[i]! + r * path.sx[n]!
  const y = path.sy[j + 1]! - path.sy[i]! + r * path.sy[n]!
  const x2 = path.sx2[j + 1]! - path.sx2[i]! + r * path.sx2[n]!
  const xy = path.sxy[j + 1]! - path.sxy[i]! + r * path.sxy[n]!
  const y2 = path.sy2[j + 1]! - path.sy2[i]! + r * path.sy2[n]!
  const k = j + 1 - i + r * n
  const cx = x / k
  const cy = y / k
  let a = (x2 - (x * x) / k) / k
  const b = (xy - (x * y) / k) / k
  let c = (y2 - (y * y) / k) / k
  const lambda2 = (a + c + Math.sqrt((a - c) * (a - c) + 4 * b * b)) / 2
  a -= lambda2
  c -= lambda2
  let dx = 0
  let dy = 0
  if (Math.abs(a) >= Math.abs(c)) {
    const l = Math.sqrt(a * a + b * b)
    if (l !== 0) {
      dx = -b / l
      dy = a / l
    }
  } else {
    const l = Math.sqrt(c * c + b * b)
    if (l !== 0) {
      dx = -c / l
      dy = b / l
    }
  }
  return { cx, cy, dx, dy }
}

type Quad = Float64Array // 3x3 row-major

function lineQuad(line: { cx: number; cy: number; dx: number; dy: number }): Quad {
  const q = new Float64Array(9)
  const d = line.dx * line.dx + line.dy * line.dy
  if (d === 0) return q
  const v0 = line.dy
  const v1 = -line.dx
  const v2 = -v1 * line.cy - v0 * line.cx
  const v = [v0, v1, v2]
  for (let l = 0; l < 3; l++) for (let k = 0; k < 3; k++) q[l * 3 + k] = (v[l]! * v[k]!) / d
  return q
}

function quadForm(Q: Quad, wx: number, wy: number): number {
  const v = [wx, wy, 1]
  let sum = 0
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sum += v[i]! * Q[i * 3 + j]! * v[j]!
  return sum
}

/** Places a polygon vertex at the least-squares intersection of its two edge lines, constrained to its pixel square. */
function optimalVertex(Q0: Quad, sx: number, sy: number): Pt {
  const Q = Float64Array.from(Q0)
  let wx = 0
  let wy = 0
  for (;;) {
    const det = Q[0]! * Q[4]! - Q[1]! * Q[3]!
    if (det !== 0) {
      wx = (-Q[2]! * Q[4]! + Q[5]! * Q[1]!) / det
      wy = (Q[2]! * Q[3]! - Q[5]! * Q[0]!) / det
      break
    }
    // Degenerate (parallel lines): add a constraint through the original vertex.
    let v0: number
    let v1: number
    if (Q[0]! > Q[4]!) {
      v0 = -Q[1]!
      v1 = Q[0]!
    } else if (Q[4]) {
      v0 = -Q[4]!
      v1 = Q[3]!
    } else {
      v0 = 1
      v1 = 0
    }
    const d = v0 * v0 + v1 * v1
    const v2 = -v1 * sy - v0 * sx
    const v = [v0, v1, v2]
    for (let l = 0; l < 3; l++) for (let k = 0; k < 3; k++) Q[l * 3 + k] = Q[l * 3 + k]! + (v[l]! * v[k]!) / d
  }
  if (Math.abs(wx - sx) <= 0.5 && Math.abs(wy - sy) <= 0.5) return { x: wx, y: wy }

  let min = quadForm(Q, sx, sy)
  let xmin = sx
  let ymin = sy
  if (Q[0] !== 0) {
    for (let z = 0; z < 2; z++) {
      const cy = sy - 0.5 + z
      const cx = -(Q[1]! * cy + Q[2]!) / Q[0]!
      const cand = quadForm(Q, cx, cy)
      if (Math.abs(cx - sx) <= 0.5 && cand < min) {
        min = cand
        xmin = cx
        ymin = cy
      }
    }
  }
  if (Q[4] !== 0) {
    for (let z = 0; z < 2; z++) {
      const cx = sx - 0.5 + z
      const cy = -(Q[3]! * cx + Q[5]!) / Q[4]!
      const cand = quadForm(Q, cx, cy)
      if (Math.abs(cy - sy) <= 0.5 && cand < min) {
        min = cand
        xmin = cx
        ymin = cy
      }
    }
  }
  for (let l = 0; l < 2; l++) {
    for (let k = 0; k < 2; k++) {
      const cx = sx - 0.5 + l
      const cy = sy - 0.5 + k
      const cand = quadForm(Q, cx, cy)
      if (cand < min) {
        min = cand
        xmin = cx
        ymin = cy
      }
    }
  }
  return { x: xmin, y: ymin }
}

function adjustVertices(path: LatticePath, po: number[]): Pt[] {
  const m = po.length
  const n = path.n
  const { closed, x0, y0 } = path
  const edgeCount = closed ? m : m - 1
  const quads: Quad[] = []
  for (let i = 0; i < edgeCount; i++) {
    let j = po[closed ? mod(i + 1, m) : i + 1]!
    if (closed) j = mod(j - po[i]!, n) + po[i]!
    quads.push(lineQuad(pointSlope(path, po[i]!, j)))
  }
  const vertices: Pt[] = []
  for (let i = 0; i < m; i++) {
    const sx = path.x[po[i]!]! - x0
    const sy = path.y[po[i]!]! - y0
    if (!closed && (i === 0 || i === m - 1)) {
      vertices.push({ x: sx + x0, y: sy + y0 })
      continue
    }
    const qa = quads[closed ? mod(i - 1, m) : i - 1]!
    const qb = quads[i]!
    const Q = new Float64Array(9)
    for (let k = 0; k < 9; k++) Q[k] = qa[k]! + qb[k]!
    const v = optimalVertex(Q, sx, sy)
    vertices.push({ x: v.x + x0, y: v.y + y0 })
  }
  return vertices
}


/**
 * Polygon-level corner restoration. At super-sampled resolution a crisp 90°
 * corner arrives rounded (anti-aliasing + resampling blur), so the optimal
 * polygon cuts it with one or more short edges; smoothing would then turn it
 * into an arc and curve optimization would bow the adjacent straight edges
 * into it. Where a short run of edges sits between two long edges that turn
 * by a real angle, the run collapses into the exact intersection of the two
 * long edges' lines — which smoothing then recognizes as a sharp corner.
 */
function snapPolygonCorners(vertices: Pt[], closed: boolean, options: CornerSnapOptions, path: LatticePath, po: number[]): Pt[] {
  const m = vertices.length
  if (m < 4) return vertices
  const edgeCount = closed ? m : m - 1
  const edgeLen = (i: number) => {
    const a = vertices[i % m]!
    const b = vertices[(i + 1) % m]!
    return Math.hypot(b.x - a.x, b.y - a.y)
  }
  const isLong = (i: number) => edgeLen(i) >= options.minLineLength
  const cosLimit = Math.cos((options.minTurnDegrees * Math.PI) / 180)
  const n = path.n
  /** Best-fit line of polygon edge i's lattice points, direction oriented along the edge. */
  const edgeLine = (i: number) => {
    const from = po[i]!
    let to = closed && i === m - 1 ? po[0]! + n : po[i + 1]!
    if (closed && to < from) to += n
    const trim = Math.min(Math.floor((to - from) * 0.25), Math.ceil(options.maxCornerSpan))
    const line = to - from - 2 * trim >= 2 ? pointSlope(path, from + trim, to - trim) : pointSlope(path, from, to)
    const a = vertices[i % m]!
    const b = vertices[(i + 1) % m]!
    const sign = line.dx * (b.x - a.x) + line.dy * (b.y - a.y) < 0 ? -1 : 1
    return { cx: line.cx + path.x0, cy: line.cy + path.y0, dx: line.dx * sign, dy: line.dy * sign }
  }
  // replaced[k] = vertex index range to drop, with the new corner point.
  const replacements: { from: number; count: number; point: Pt }[] = []
  const claimed = new Uint8Array(m)

  for (let i = 0; i < edgeCount; i++) {
    if (!isLong(i)) continue
    let span = 0
    let k = 0
    let j = i + 1
    for (; k < 6; k++, j++) {
      if (!closed && j >= edgeCount) break
      if (isLong(j % edgeCount)) break
      span += edgeLen(j % edgeCount)
    }
    if (k === 0 || k >= 6 || (!closed && j >= edgeCount) || span > options.maxCornerSpan * 1.6) continue
    const a1 = vertices[(i + 1) % m]!
    const b0 = vertices[j % m]!
    // Intersect the best-fit lines of the two long edges' lattice points
    // (trimmed away from the rounded ends), not the lines through their
    // adjusted end vertices, which the rounding has already pulled inward.
    const lineA = edgeLine(i)
    const lineB = edgeLine(j % edgeCount)
    const cross = lineA.dx * lineB.dy - lineA.dy * lineB.dx
    if (Math.abs(cross) < 1e-9) continue
    const cos = lineA.dx * lineB.dx + lineA.dy * lineB.dy
    if (cos > cosLimit) continue
    const t = ((lineB.cx - lineA.cx) * lineB.dy - (lineB.cy - lineA.cy) * lineB.dx) / cross
    const X = { x: lineA.cx + t * lineA.dx, y: lineA.cy + t * lineA.dy }
    const reach = Math.max(Math.hypot(X.x - a1.x, X.y - a1.y), Math.hypot(X.x - b0.x, X.y - b0.y))
    if (reach > options.maxCornerSpan || !Number.isFinite(X.x) || !Number.isFinite(X.y)) continue
    // Vertices a1 .. b0 (k + 1 of them) collapse into X.
    let clash = false
    for (let v = i + 1; v <= j; v++) if (claimed[v % m]) clash = true
    if (!closed && j >= m - 1) clash = true
    if (clash) continue
    for (let v = i + 1; v <= j; v++) claimed[v % m] = 1
    replacements.push({ from: (i + 1) % m, count: k + 1, point: X })
  }
  if (replacements.length === 0) return vertices
  const replacementAt = new Map<number, Pt>()
  for (const r of replacements) replacementAt.set(r.from, r.point)
  const out: Pt[] = []
  for (let v = 0; v < m; v++) {
    const point = replacementAt.get(v)
    if (point) out.push(point)
    else if (!claimed[v]) out.push(vertices[v]!)
  }
  return out.length >= (closed ? 3 : 2) ? out : vertices
}

// ---------------------------------------------------------------------------
// Stages 4-5: smoothing and curve optimization
// ---------------------------------------------------------------------------

interface CurveData {
  /** Number of vertex segments. */
  m: number
  closed: boolean
  vertex: Pt[]
  /** Per segment: tag and control points [c0, c1, c2]; c2 is the segment end. */
  corner: boolean[]
  c: Pt[][]
  alpha: number[]
}

/**
 * Closed: segment j spans midpoint(v[j-1], v[j]) -> midpoint(v[j], v[j+1]),
 * bending around vertex j. Open: segments exist for interior vertices only;
 * index 0's end point is midpoint(v0, v1) (the end of the leading line).
 */
function smooth(vertices: Pt[], closed: boolean, alphaMax: number): CurveData {
  const m = vertices.length
  const corner: boolean[] = new Array(m).fill(true)
  const c: Pt[][] = new Array(m)
  const alpha: number[] = new Array(m).fill(0)
  for (let j = 0; j < m; j++) {
    if (!closed && (j === 0 || j === m - 1)) {
      const next = vertices[Math.min(j + 1, m - 1)]!
      const end = j === 0 ? lerp(vertices[0]!, next, 0.5) : vertices[j]!
      c[j] = [vertices[j]!, vertices[j]!, end]
      continue
    }
    const i = closed ? mod(j - 1, m) : j - 1
    const k = closed ? mod(j + 1, m) : j + 1
    const vi = vertices[i]!
    const vj = vertices[j]!
    const vk = vertices[k]!
    const p4 = lerp(vk, vj, 0.5)
    const denom = ddenom(vi, vk)
    let a: number
    if (denom !== 0) {
      const dd = Math.abs(dpara(vi, vj, vk) / denom)
      a = dd > 1 ? 1 - 1 / dd : 0
      a = a / 0.75
    } else {
      a = 4 / 3
    }
    if (a >= alphaMax) {
      corner[j] = true
      c[j] = [vj, vj, p4]
      alpha[j] = a
    } else {
      a = Math.max(0.55, Math.min(1, a))
      const lambda = 0.5 + 0.5 * a
      corner[j] = false
      c[j] = [lerp(vi, vj, lambda), lerp(vk, vj, lambda), p4]
      alpha[j] = a
    }
  }
  return { m, closed, vertex: vertices, corner, c, alpha }
}

interface Opti {
  pen: number
  c0: Pt
  c1: Pt
  alpha: number
  s: number
  t: number
}

/**
 * Potrace opticurve: tries to replace segments i+1..j by one Bézier from
 * c[i][2] to c[j][2]. Returns null when not possible within tolerance.
 */
function optiPenalty(curve: CurveData, i: number, j: number, tolerance: number, convc: number[], areac: number[]): Opti | null {
  const { m, vertex, c } = curve
  const wrap = (a: number) => (curve.closed ? mod(a, m) : a)
  if (i === j) return null
  const i1 = wrap(i + 1)
  const conv = convc[i1]!
  if (conv === 0) return null
  const d = ddist(vertex[i]!, vertex[i1]!)
  for (let k = i1; k !== j; ) {
    const k1 = wrap(k + 1)
    const k2 = wrap(k + 2)
    if (convc[k1] !== conv) return null
    if (sign(cprod(vertex[i]!, vertex[i1]!, vertex[k1]!, vertex[k2]!)) !== conv) return null
    if (iprod1(vertex[i]!, vertex[i1]!, vertex[k1]!, vertex[k2]!) < d * ddist(vertex[k1]!, vertex[k2]!) * -0.999847695156) return null
    k = k1
  }

  const p0 = c[wrap(i)]![2]!
  const p1 = vertex[wrap(i + 1)]!
  const p2 = vertex[wrap(j)]!
  const p3 = c[wrap(j)]![2]!

  let area = areac[j]! - areac[i]!
  area -= dpara(vertex[0]!, c[i]![2]!, c[j]![2]!) / 2
  if (i >= j) area += areac[m]!

  const A1 = dpara(p0, p1, p2)
  const A2 = dpara(p0, p1, p3)
  const A3 = dpara(p0, p2, p3)
  const A4 = A1 + A3 - A2
  if (A2 === A1) return null
  const t = A3 / (A3 - A4)
  const s = A2 / (A2 - A1)
  const A = (A2 * t) / 2
  if (A === 0) return null
  const R = area / A
  const alpha = 2 - Math.sqrt(4 - R / 0.3)
  if (!Number.isFinite(alpha)) return null
  const c0 = lerp(p0, p1, t * alpha)
  const c1 = lerp(p3, p2, s * alpha)
  let pen = 0

  for (let k = wrap(i + 1); k !== j; ) {
    const k1 = wrap(k + 1)
    const tt = tangentParam(p0, c0, c1, p3, vertex[k]!, vertex[k1]!)
    if (tt < -0.5) return null
    const pt = bezierPoint(tt, p0, c0, c1, p3)
    const dd = ddist(vertex[k]!, vertex[k1]!)
    if (dd === 0) return null
    const d1 = dpara(vertex[k]!, vertex[k1]!, pt) / dd
    if (Math.abs(d1) > tolerance) return null
    if (iprod(vertex[k]!, vertex[k1]!, pt) < 0 || iprod(vertex[k1]!, vertex[k]!, pt) < 0) return null
    pen += d1 * d1
    k = k1
  }
  for (let k = i; k !== j; ) {
    const k1 = wrap(k + 1)
    const tt = tangentParam(p0, c0, c1, p3, c[k]![2]!, c[k1]![2]!)
    if (tt < -0.5) return null
    const pt = bezierPoint(tt, p0, c0, c1, p3)
    const dd = ddist(c[k]![2]!, c[k1]![2]!)
    if (dd === 0) return null
    let d1 = dpara(c[k]![2]!, c[k1]![2]!, pt) / dd
    let d2 = dpara(c[k]![2]!, c[k1]![2]!, vertex[k1]!) / dd
    d2 *= 0.75 * curve.alpha[k1]!
    if (d2 < 0) {
      d1 = -d1
      d2 = -d2
    }
    if (d1 < d2 - tolerance) return null
    if (d1 < d2) pen += (d1 - d2) * (d1 - d2)
    k = k1
  }
  return { pen, c0, c1, alpha, s, t }
}

interface OutSegment {
  corner: boolean
  c0: Pt
  c1: Pt
  vertex: Pt
  end: Pt
}

/**
 * Runs the Potrace opticurve dynamic program over segment endpoints
 * [first..last] (inclusive node indices), returning merged segments.
 */
function optimizeCurve(curve: CurveData, tolerance: number): OutSegment[] {
  const { m, vertex, c, corner, closed } = curve
  const toOut = (j: number): OutSegment => ({ corner: corner[j]!, c0: c[j]![0]!, c1: c[j]![1]!, vertex: vertex[j]!, end: c[j]![2]! })

  // Node index range: closed paths use nodes 0..m (node m == node 0);
  // open chains use nodes 0..m-2 (segment ends of interior vertices).
  const lastNode = closed ? m : m - 2
  const convc: number[] = new Array(m).fill(0)
  for (let i = 0; i < m; i++) {
    if (!closed && (i === 0 || i === m - 1)) continue
    if (!corner[i]) {
      const prev = closed ? mod(i - 1, m) : i - 1
      const next = closed ? mod(i + 1, m) : i + 1
      convc[i] = sign(dpara(vertex[prev]!, vertex[i]!, vertex[next]!))
    }
  }
  const areac: number[] = new Array(m + 1).fill(0)
  let area = 0
  const p0 = vertex[0]!
  const areaLimit = closed ? m : m - 2
  for (let i = 0; i < areaLimit; i++) {
    const i1 = closed ? mod(i + 1, m) : i + 1
    if (!corner[i1]) {
      const a = curve.alpha[i1]!
      area += (0.3 * a * (4 - a) * dpara(c[i]![2]!, vertex[i1]!, c[i1]![2]!)) / 2
      area += dpara(p0, c[i]![2]!, c[i1]![2]!) / 2
    }
    areac[i + 1] = area
  }

  if (tolerance <= 0 || lastNode < 2) {
    const out: OutSegment[] = []
    for (let j = 1; j <= lastNode; j++) out.push(toOut(closed ? mod(j, m) : j))
    return out
  }

  const pt = new Int32Array(lastNode + 1)
  const pen = new Float64Array(lastNode + 1)
  const len = new Int32Array(lastNode + 1)
  const opt: (Opti | null)[] = new Array(lastNode + 1).fill(null)
  pt[0] = -1
  for (let j = 1; j <= lastNode; j++) {
    pt[j] = j - 1
    pen[j] = pen[j - 1]!
    len[j] = len[j - 1]! + 1
    for (let i = j - 2; i >= 0; i--) {
      const o = optiPenalty(curve, i, closed ? mod(j, m) : j, tolerance, convc, areac)
      if (!o) break
      if (len[j]! > len[i]! + 1 || (len[j] === len[i]! + 1 && pen[j]! > pen[i]! + o.pen)) {
        pt[j] = i
        pen[j] = pen[i]! + o.pen
        len[j] = len[i]! + 1
        opt[j] = o
      }
    }
  }

  const out: OutSegment[] = []
  for (let j = lastNode; j > 0; j = pt[j]!) {
    const jj = closed ? mod(j, m) : j
    const o = opt[j]
    if (pt[j] === j - 1 || !o) {
      out.push(toOut(jj))
    } else {
      out.push({ corner: false, c0: o.c0, c1: o.c1, vertex: lerp(c[jj]![2]!, vertex[jj]!, o.s), end: c[jj]![2]! })
    }
  }
  return out.reverse()
}

function emit(segments: Segment[], seg: OutSegment): void {
  if (seg.corner) {
    segments.push({ type: 'L', x: seg.vertex.x, y: seg.vertex.y })
    segments.push({ type: 'L', x: seg.end.x, y: seg.end.y })
  } else {
    segments.push({ type: 'C', x1: seg.c0.x, y1: seg.c0.y, x2: seg.c1.x, y2: seg.c1.y, x: seg.end.x, y: seg.end.y })
  }
}

/** A boundary line near a chain end: best-fit line of that end's first polygon edge. */
export interface EndLine {
  cx: number
  cy: number
  dx: number
  dy: number
  /** Number of lattice points supporting the line (weight). */
  support: number
}

/** Stage-3 result for one chain: its (adjusted) polygon, before smoothing. */
export interface ChainPolygon {
  closed: boolean
  vertices: Pt[]
  /** Open chains only: lines of the first/last polygon edge, for junction refinement. */
  startLine: EndLine | null
  endLine: EndLine | null
  /** Degenerate chains (too short to fit) are emitted as their raw lattice polyline. */
  raw: Pt[] | null
}

function endLine(path: LatticePath, i: number, j: number): EndLine {
  const line = pointSlope(path, i, j)
  return { cx: line.cx + path.x0, cy: line.cy + path.y0, dx: line.dx, dy: line.dy, support: j - i + 1 }
}

/**
 * Stages 1-3 for one chain: lattice path -> optimal polygon -> adjusted
 * vertices (+ corner restoration). Open-chain endpoints stay on the lattice
 * here; refineJunctions() may move them before buildCurve() runs.
 */
export function buildPolygon(points: Int32Array, closed: boolean, options: FitOptions): ChainPolygon {
  const total = points.length / 2
  const count = closed ? total - 1 : total
  if (count < 2 || (closed && count < 4)) {
    const raw: Pt[] = []
    for (let i = 0; i < total; i++) raw.push({ x: points[i * 2]!, y: points[i * 2 + 1]! })
    return { closed, vertices: [], startLine: null, endLine: null, raw }
  }
  const path = new LatticePath(points, count, closed)
  const lon = calcLon(path)
  const po = closed ? bestPolygonClosed(path, lon) : bestPolygonOpen(path, lon)
  const adjusted = adjustVertices(path, po)
  const vertices = options.cornerSnap ? snapPolygonCorners(adjusted, closed, options.cornerSnap, path, po) : adjusted
  if (closed) return { closed, vertices, startLine: null, endLine: null, raw: null }
  const m = po.length
  return {
    closed,
    vertices,
    startLine: endLine(path, po[0]!, po[1]!),
    endLine: endLine(path, po[m - 2]!, po[m - 1]!),
    raw: null,
  }
}

/** Stages 4-5: smoothing and curve optimization of a (possibly junction-refined) polygon. */
export function buildCurve(polygon: ChainPolygon, options: FitOptions): FittedChain {
  if (polygon.raw) {
    const first = polygon.raw[0]!
    return { startX: first.x, startY: first.y, segments: polygon.raw.slice(1).map((p) => ({ type: 'L' as const, x: p.x, y: p.y })) }
  }
  const { vertices, closed } = polygon
  if (!closed) {
    const start = vertices[0]!
    const end = vertices[vertices.length - 1]!
    if (vertices.length <= 2) return { startX: start.x, startY: start.y, segments: [{ type: 'L', x: end.x, y: end.y }] }
    const curve = smooth(vertices, false, options.alphaMax)
    const segments: Segment[] = []
    const lead = curve.c[0]![2]!
    segments.push({ type: 'L', x: lead.x, y: lead.y })
    for (const seg of optimizeCurve(curve, options.optTolerance)) emit(segments, seg)
    segments.push({ type: 'L', x: end.x, y: end.y })
    return { startX: start.x, startY: start.y, segments: straightenFlatCurves(start.x, start.y, mergeCollinear(start.x, start.y, segments), 0.12) }
  }
  const curve = smooth(vertices, true, options.alphaMax)
  const merged = optimizeCurve(curve, options.optTolerance)
  let segments: Segment[] = []
  for (const seg of merged) emit(segments, seg)
  let start: Pt = merged[merged.length - 1]!.end
  // Potrace starts a closed loop mid-edge; if the loop has a corner, start
  // there instead so the two halves of the split edge merge into one.
  segments = straightenFlatCurves(start.x, start.y, segments, 0.12)
  for (let k = 0; k < segments.length; k++) {
    const current = segments[k]!
    const next = segments[(k + 1) % segments.length]!
    if (current.type === 'L' && next.type === 'L') {
      start = { x: current.x, y: current.y }
      segments = [...segments.slice(k + 1), ...segments.slice(0, k + 1)]
      break
    }
  }
  return { startX: start.x, startY: start.y, segments: mergeCollinear(start.x, start.y, segments) }
}

/** Convenience: fit a chain with fixed lattice endpoints (no junction refinement). */
export function fitChain(points: Int32Array, closed: boolean, options: FitOptions): FittedChain {
  return buildCurve(buildPolygon(points, closed, options), options)
}

/**
 * Junction refinement. Chain endpoints start on the pixel-corner lattice,
 * which can sit up to half a working pixel (more after blur) away from where
 * the boundaries really meet — visible as slightly tilted edges next to every
 * point where three colors meet or two shapes touch corner to corner. Each
 * junction moves to the weighted least-squares intersection of the boundary
 * lines ending there (the same construction Potrace uses for polygon
 * vertices), with a weak pull toward its lattice position for stability and
 * a bounded displacement. Junctions on the image border stay on the border.
 */
export function refineJunctions(
  polygons: ChainPolygon[],
  imageWidth: number,
  imageHeight: number,
  maxShift: number,
): void {
  interface End {
    polygon: ChainPolygon
    atStart: boolean
  }
  const ends = new Map<number, End[]>()
  const key = (p: Pt) => p.y * 1_000_003 + p.x
  for (const polygon of polygons) {
    if (polygon.closed || polygon.raw || polygon.vertices.length < 2) continue
    const first = polygon.vertices[0]!
    const last = polygon.vertices[polygon.vertices.length - 1]!
    for (const [point, atStart] of [
      [first, true],
      [last, false],
    ] as const) {
      const k = key(point)
      const list = ends.get(k)
      if (list) list.push({ polygon, atStart })
      else ends.set(k, [{ polygon, atStart }])
    }
  }

  for (const list of ends.values()) {
    const sample = list[0]!
    const J = sample.atStart ? sample.polygon.vertices[0]! : sample.polygon.vertices[sample.polygon.vertices.length - 1]!
    // Quadratic form in coordinates relative to J: sum w * (n·(p - c))^2
    // plus a weak isotropic pull toward J.
    let a = 0.02
    let b = 0
    let c = 0.02
    let d = 0
    let e = 0
    for (const end of list) {
      const line = end.atStart ? end.polygon.startLine : end.polygon.endLine
      if (!line || (line.dx === 0 && line.dy === 0)) continue
      const nx = -line.dy
      const ny = line.dx
      const w = Math.sqrt(line.support)
      const off = nx * (line.cx - J.x) + ny * (line.cy - J.y)
      a += w * nx * nx
      b += w * nx * ny
      c += w * ny * ny
      d += w * nx * off
      e += w * ny * off
    }
    const det = a * c - b * b
    if (Math.abs(det) < 1e-12) continue
    let ox = (c * d - b * e) / det
    let oy = (a * e - b * d) / det
    const shift = Math.hypot(ox, oy)
    if (shift > maxShift) {
      ox *= maxShift / shift
      oy *= maxShift / shift
    }
    if (J.x === 0 || J.x === imageWidth) ox = 0
    if (J.y === 0 || J.y === imageHeight) oy = 0
    const moved = { x: J.x + ox, y: J.y + oy }
    for (const end of list) {
      const vs = end.polygon.vertices
      if (end.atStart) vs[0] = moved
      else vs[vs.length - 1] = moved
    }
  }
}

/** Drops line segments that continue straight on from the previous line (e.g. lead-in lines). */
function mergeCollinear(startX: number, startY: number, segments: Segment[]): Segment[] {
  const out: Segment[] = []
  let px = startX
  let py = startY
  for (const seg of segments) {
    const prev = out[out.length - 1]
    if (seg.type === 'L') {
      if (Math.abs(seg.x - px) < 1e-9 && Math.abs(seg.y - py) < 1e-9) continue
      if (prev && prev.type === 'L') {
        // Previous line starts where? Recover it from the one before.
        const before = out[out.length - 2]
        const bx = before ? before.x : startX
        const by = before ? before.y : startY
        const cross = (prev.x - bx) * (seg.y - prev.y) - (prev.y - by) * (seg.x - prev.x)
        const dot = (prev.x - bx) * (seg.x - prev.x) + (prev.y - by) * (seg.y - prev.y)
        const len = Math.hypot(prev.x - bx, prev.y - by) * Math.hypot(seg.x - prev.x, seg.y - prev.y)
        if (len > 0 && Math.abs(cross) / len < 1e-6 && dot > 0) {
          out[out.length - 1] = { type: 'L', x: seg.x, y: seg.y }
          px = seg.x
          py = seg.y
          continue
        }
      }
    }
    out.push(seg)
    px = seg.x
    py = seg.y
  }
  return out
}

export function reverseFitted(fitted: FittedChain): FittedChain {
  const { segments } = fitted
  if (segments.length === 0) return fitted
  const last = segments[segments.length - 1]!
  const out: Segment[] = []
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!
    const prev = i > 0 ? segments[i - 1]! : null
    const px = prev ? prev.x : fitted.startX
    const py = prev ? prev.y : fitted.startY
    if (seg.type === 'L') out.push({ type: 'L', x: px, y: py })
    else out.push({ type: 'C', x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1, x: px, y: py })
  }
  return { startX: last.x, startY: last.y, segments: out }
}

/** Converts curves whose control points lie on the chord into lines. */
export function straightenFlatCurves(x0: number, y0: number, segments: Segment[], tolerance: number): Segment[] {
  let px = x0
  let py = y0
  return segments.map((seg) => {
    let out = seg
    if (seg.type === 'C') {
      const dx = seg.x - px
      const dy = seg.y - py
      const len = Math.hypot(dx, dy)
      if (len > 0) {
        const d1 = Math.abs((seg.x1 - px) * dy - (seg.y1 - py) * dx) / len
        const d2 = Math.abs((seg.x2 - px) * dy - (seg.y2 - py) * dx) / len
        if (d1 <= tolerance && d2 <= tolerance) out = { type: 'L', x: seg.x, y: seg.y }
      }
    }
    px = seg.x
    py = seg.y
    return out
  })
}

