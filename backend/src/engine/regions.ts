/**
 * Region segmentation: connected components over the label map, and speckle
 * removal that merges tiny regions into the neighbour they share the most
 * border with (the way a designer would "clean up" stray pixels), instead of
 * ImageTracer's pathomit, which simply deletes small paths and leaves holes.
 */
import { TRANSPARENT_LABEL, type PaletteColor } from './palette'

export interface Components {
  /** Per-pixel component id (0..count-1). */
  ids: Int32Array
  count: number
  /** Per-component palette label (TRANSPARENT_LABEL for transparent). */
  labels: Int32Array
  areas: Int32Array
}

/** 4-connected components of equal labels (two-pass union-find). */
export function connectedComponents(labels: Int32Array, width: number, height: number): Components {
  const n = width * height
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i

  const find = (x: number): number => {
    let r = x
    while (parent[r] !== r) r = parent[r]!
    while (parent[x] !== r) {
      const next = parent[x]!
      parent[x] = r
      x = next
    }
    return r
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const label = labels[p]
      if (x > 0 && labels[p - 1] === label) {
        const a = find(p)
        const b = find(p - 1)
        if (a !== b) parent[a < b ? b : a] = a < b ? a : b
      }
      if (y > 0 && labels[p - width] === label) {
        const a = find(p)
        const b = find(p - width)
        if (a !== b) parent[a < b ? b : a] = a < b ? a : b
      }
    }
  }

  const ids = new Int32Array(n)
  const rootToId = new Int32Array(n).fill(-1)
  let count = 0
  for (let p = 0; p < n; p++) {
    const r = find(p)
    let id = rootToId[r]!
    if (id < 0) {
      id = count++
      rootToId[r] = id
    }
    ids[p] = id
  }
  const compLabels = new Int32Array(count)
  const areas = new Int32Array(count)
  for (let p = 0; p < n; p++) {
    const id = ids[p]!
    compLabels[id] = labels[p]!
    areas[id] = areas[id]! + 1
  }
  return { ids, count, labels: compLabels, areas }
}

function colorDistance(palette: PaletteColor[], a: number, b: number): number {
  if (a === TRANSPARENT_LABEL || b === TRANSPARENT_LABEL) return a === b ? 0 : 1
  const ca = palette[a]
  const cb = palette[b]
  if (!ca || !cb) return 1
  return Math.hypot(ca.L - cb.L, ca.A - cb.A, ca.B - cb.B)
}

/**
 * Merges every component smaller than `minArea` into its best neighbour
 * (longest shared border, ties broken by color similarity). Returns a new
 * label map; callers re-run connectedComponents on it.
 */
export function mergeSmallRegions(
  labels: Int32Array,
  width: number,
  height: number,
  palette: PaletteColor[],
  minArea: number,
): Int32Array {
  const comps = connectedComponents(labels, width, height)
  const { ids, count, areas } = comps
  const compLabel = comps.labels.slice()

  let smallCount = 0
  for (let c = 0; c < count; c++) if (areas[c]! < minArea) smallCount++
  if (smallCount === 0) return labels

  // Border lengths between components, only tracked for small components
  // (the only ones that ever look up their neighbours).
  const adjacency: (Map<number, number> | null)[] = new Array(count).fill(null)
  const addBorder = (a: number, b: number) => {
    if (areas[a]! < minArea) {
      let m = adjacency[a]
      if (!m) {
        m = new Map()
        adjacency[a] = m
      }
      m.set(b, (m.get(b) ?? 0) + 1)
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const a = ids[p]!
      if (x + 1 < width) {
        const b = ids[p + 1]!
        if (a !== b) {
          addBorder(a, b)
          addBorder(b, a)
        }
      }
      if (y + 1 < height) {
        const b = ids[p + width]!
        if (a !== b) {
          addBorder(a, b)
          addBorder(b, a)
        }
      }
    }
  }

  const parent = new Int32Array(count)
  for (let i = 0; i < count; i++) parent[i] = i
  const find = (x: number): number => {
    let r = x
    while (parent[r] !== r) r = parent[r]!
    while (parent[x] !== r) {
      const next = parent[x]!
      parent[x] = r
      x = next
    }
    return r
  }
  const area = Int32Array.from(areas)

  const order = Array.from({ length: count }, (_, i) => i)
    .filter((c) => areas[c]! < minArea)
    .sort((a, b) => areas[a]! - areas[b]!)

  for (const c of order) {
    if (find(c) !== c || area[c]! >= minArea) continue
    const borders = adjacency[c]
    if (!borders || borders.size === 0) continue

    // Aggregate borders by current root.
    const byRoot = new Map<number, number>()
    for (const [neighbour, length] of borders) {
      const root = find(neighbour)
      if (root === c) continue
      byRoot.set(root, (byRoot.get(root) ?? 0) + length)
    }
    let best = -1
    let bestLength = -1
    let bestDistance = Infinity
    for (const [root, length] of byRoot) {
      const distance = colorDistance(palette, compLabel[c]!, compLabel[root]!)
      if (length > bestLength || (length === bestLength && distance < bestDistance)) {
        best = root
        bestLength = length
        bestDistance = distance
      }
    }
    if (best < 0) continue

    parent[c] = best
    area[best] = area[best]! + area[c]!
    // Carry this component's neighbours over so a still-small target can
    // keep growing through them.
    if (area[best]! < minArea) {
      let target = adjacency[best]
      if (!target) {
        target = new Map()
        adjacency[best] = target
      }
      for (const [neighbour, length] of byRoot) {
        if (neighbour !== best) target.set(neighbour, (target.get(neighbour) ?? 0) + length)
      }
    }
  }

  const out = new Int32Array(labels.length)
  for (let p = 0; p < labels.length; p++) out[p] = compLabel[find(ids[p]!)]!
  return out
}
