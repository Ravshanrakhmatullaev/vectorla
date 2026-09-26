/**
 * Planar-map boundary extraction.
 *
 * The defining difference between a professional multi-color tracer and
 * "trace each color layer separately" (ImageTracer, per-color Potrace): every
 * boundary between two regions is extracted ONCE, as a chain of pixel-crack
 * vertices running between junctions (points where 3+ regions meet). Each
 * chain is then curve-fitted once and shared by both regions it separates, so
 * neighbouring shapes meet exactly — no gaps, no overlaps, no need for the
 * same-color stroke ImageTracer adds to hide seams (which fattens every shape).
 *
 * Coordinates are on the pixel-corner lattice: vertex (x, y) is the top-left
 * corner of pixel (x, y); the image spans [0, width] x [0, height].
 */

export const OUTSIDE = -1

export interface Chain {
  /** Interleaved lattice coordinates x0,y0,x1,y1,... */
  points: Int32Array
  /** Region on the left of the walking direction (screen coordinates, y down). */
  left: number
  right: number
  /** True when the chain is a junction-free loop (start == end, no fixed endpoints). */
  closed: boolean
}

export interface ChainUse {
  chain: number
  reversed: boolean
}

export interface RegionLoop {
  uses: ChainUse[]
  /** Signed lattice-polygon area (region-on-left traversal gives a consistent sign for outer loops). */
  area: number
}

export interface RegionBoundary {
  region: number
  outer: RegionLoop | null
  holes: RegionLoop[]
}

// Direction codes: 0 = east, 1 = south, 2 = west, 3 = north.
const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]

export function extractChains(ids: Int32Array, width: number, height: number): Chain[] {
  const W = width
  const H = height
  const regionAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? OUTSIDE : ids[y * W + x]!)

  // Horizontal crack (x, y): between pixel (x, y-1) and (x, y); x in [0,W), y in [0,H].
  // Vertical crack (x, y): between pixel (x-1, y) and (x, y); x in [0,W], y in [0,H).
  const hVisited = new Uint8Array(W * (H + 1))
  const vVisited = new Uint8Array((W + 1) * H)
  const hBoundary = (x: number, y: number) => regionAt(x, y - 1) !== regionAt(x, y)
  const vBoundary = (x: number, y: number) => regionAt(x - 1, y) !== regionAt(x, y)

  /** Bitmask of directions (from vertex x,y) along which a boundary crack runs. */
  const boundaryMask = (x: number, y: number): number => {
    let mask = 0
    if (x < W && hBoundary(x, y)) mask |= 1
    if (y < H && vBoundary(x, y)) mask |= 2
    if (x > 0 && hBoundary(x - 1, y)) mask |= 4
    if (y > 0 && vBoundary(x, y - 1)) mask |= 8
    return mask
  }
  const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1)
  const isJunction = (x: number, y: number) => popcount(boundaryMask(x, y)) >= 3

  const isVisited = (x: number, y: number, d: number): boolean => {
    switch (d) {
      case 0:
        return hVisited[y * W + x] === 1
      case 2:
        return hVisited[y * W + x - 1] === 1
      case 1:
        return vVisited[y * (W + 1) + x] === 1
      default:
        return vVisited[(y - 1) * (W + 1) + x] === 1
    }
  }
  const markVisited = (x: number, y: number, d: number): void => {
    switch (d) {
      case 0:
        hVisited[y * W + x] = 1
        break
      case 2:
        hVisited[y * W + x - 1] = 1
        break
      case 1:
        vVisited[y * (W + 1) + x] = 1
        break
      default:
        vVisited[(y - 1) * (W + 1) + x] = 1
    }
  }
  /** Regions left/right of the crack leaving (x, y) in direction d. */
  const sidesOf = (x: number, y: number, d: number): [number, number] => {
    switch (d) {
      case 0:
        return [regionAt(x, y - 1), regionAt(x, y)]
      case 1:
        return [regionAt(x, y), regionAt(x - 1, y)]
      case 2:
        return [regionAt(x - 1, y), regionAt(x - 1, y - 1)]
      default:
        return [regionAt(x - 1, y - 1), regionAt(x, y - 1)]
    }
  }

  const chains: Chain[] = []
  const buffer: number[] = []

  const walk = (sx: number, sy: number, startDir: number, closedLoop: boolean) => {
    const [left, right] = sidesOf(sx, sy, startDir)
    buffer.length = 0
    buffer.push(sx, sy)
    let x = sx
    let y = sy
    let d = startDir
    for (;;) {
      markVisited(x, y, d)
      x += DX[d]!
      y += DY[d]!
      buffer.push(x, y)
      if (x === sx && y === sy) break
      if (!closedLoop && isJunction(x, y)) break
      const mask = boundaryMask(x, y) & ~(1 << ((d + 2) & 3))
      // Degree-2 vertex: exactly one way on.
      let next = -1
      for (let k = 0; k < 4; k++) {
        if (mask & (1 << k)) {
          next = k
          break
        }
      }
      if (next < 0) break
      d = next
    }
    chains.push({ points: Int32Array.from(buffer), left, right, closed: closedLoop })
  }

  for (let y = 0; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      const mask = boundaryMask(x, y)
      if (popcount(mask) < 3) continue
      for (let d = 0; d < 4; d++) {
        if (mask & (1 << d) && !isVisited(x, y, d)) walk(x, y, d, false)
      }
    }
  }

  // Remaining unvisited boundary cracks belong to junction-free loops.
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x < W; x++) {
      if (!hVisited[y * W + x] && hBoundary(x, y)) walk(x, y, 0, true)
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x <= W; x++) {
      if (!vVisited[y * (W + 1) + x] && vBoundary(x, y)) walk(x, y, 1, true)
    }
  }

  return chains
}

function startOfUse(chain: Chain, reversed: boolean): [number, number] {
  const p = chain.points
  return reversed ? [p[p.length - 2]!, p[p.length - 1]!] : [p[0]!, p[1]!]
}
function endOfUse(chain: Chain, reversed: boolean): [number, number] {
  const p = chain.points
  return reversed ? [p[0]!, p[1]!] : [p[p.length - 2]!, p[p.length - 1]!]
}
function dirCode(dx: number, dy: number): number {
  if (dx > 0) return 0
  if (dy > 0) return 1
  if (dx < 0) return 2
  return 3
}
function firstDirOfUse(chain: Chain, reversed: boolean): number {
  const p = chain.points
  if (!reversed) return dirCode(p[2]! - p[0]!, p[3]! - p[1]!)
  const n = p.length
  return dirCode(p[n - 4]! - p[n - 2]!, p[n - 3]! - p[n - 1]!)
}
function lastDirOfUse(chain: Chain, reversed: boolean): number {
  const p = chain.points
  const n = p.length
  if (!reversed) return dirCode(p[n - 2]! - p[n - 4]!, p[n - 1]! - p[n - 3]!)
  return dirCode(p[0]! - p[2]!, p[1]! - p[3]!)
}

function signedAreaOfUse(chain: Chain, reversed: boolean): number {
  // Shoelace contribution of the chain's polyline; summing over a closed
  // loop gives twice the signed area.
  const p = chain.points
  let sum = 0
  for (let i = 0; i + 3 < p.length; i += 2) {
    sum += p[i]! * p[i + 3]! - p[i + 2]! * p[i + 1]!
  }
  return reversed ? -sum : sum
}

/**
 * Links chain uses into closed loops per region (region always on the left),
 * then classifies the loop with the largest area as the outer boundary.
 */
export function buildRegionBoundaries(chains: Chain[], regionCount: number): RegionBoundary[] {
  const usesByRegion: ChainUse[][] = Array.from({ length: regionCount }, () => [])
  chains.forEach((chain, index) => {
    if (chain.left >= 0) usesByRegion[chain.left]!.push({ chain: index, reversed: false })
    if (chain.right >= 0) usesByRegion[chain.right]!.push({ chain: index, reversed: true })
  })

  const result: RegionBoundary[] = []
  for (let region = 0; region < regionCount; region++) {
    const uses = usesByRegion[region]!
    const byStart = new Map<number, number[]>()
    const key = (x: number, y: number) => y * 1_000_003 + x
    uses.forEach((use, i) => {
      const [sx, sy] = startOfUse(chains[use.chain]!, use.reversed)
      const k = key(sx, sy)
      const list = byStart.get(k)
      if (list) list.push(i)
      else byStart.set(k, [i])
    })

    const used = new Uint8Array(uses.length)
    const loops: RegionLoop[] = []
    for (let first = 0; first < uses.length; first++) {
      if (used[first]) continue
      const loop: ChainUse[] = []
      let area = 0
      let current = first
      const [startX, startY] = startOfUse(chains[uses[first]!.chain]!, uses[first]!.reversed)
      for (let guard = 0; guard <= uses.length; guard++) {
        used[current] = 1
        const use = uses[current]!
        const chain = chains[use.chain]!
        loop.push(use)
        area += signedAreaOfUse(chain, use.reversed)
        const [ex, ey] = endOfUse(chain, use.reversed)
        if (ex === startX && ey === startY) break
        const candidates = (byStart.get(key(ex, ey)) ?? []).filter((i) => !used[i])
        if (candidates.length === 0) break
        let next = candidates[0]!
        if (candidates.length > 1) {
          // Pinch vertex: prefer the sharpest left turn, which keeps a
          // 4-connected region's boundary from crossing itself.
          const incoming = lastDirOfUse(chain, use.reversed)
          const preference = [(incoming + 3) & 3, incoming, (incoming + 1) & 3]
          let bestRank = Infinity
          for (const candidate of candidates) {
            const u = uses[candidate]!
            const rank = preference.indexOf(firstDirOfUse(chains[u.chain]!, u.reversed))
            const r = rank < 0 ? 3 : rank
            if (r < bestRank) {
              bestRank = r
              next = candidate
            }
          }
        }
        current = next
      }
      loops.push({ uses: loop, area: area / 2 })
    }

    if (loops.length === 0) {
      result.push({ region, outer: null, holes: [] })
      continue
    }
    let outerIndex = 0
    for (let i = 1; i < loops.length; i++) {
      if (Math.abs(loops[i]!.area) > Math.abs(loops[outerIndex]!.area)) outerIndex = i
    }
    result.push({
      region,
      outer: loops[outerIndex]!,
      holes: loops.filter((_, i) => i !== outerIndex),
    })
  }
  return result
}
