/**
 * Region segmentation: connected components over the label map, and speckle
 * removal that merges tiny regions into the neighbour they share the most
 * border with (the way a designer would "clean up" stray pixels), instead of
 * ImageTracer's pathomit, which simply deletes small paths and leaves holes.
 */
import type { OklabSource } from './palette'
import { TRANSPARENT_LABEL, type LabelMap, type PaletteColor } from './palette'
import { checkpoint } from './memoryCheckpoint'

export interface Components {
  /** Per-pixel component id (0..count-1). */
  ids: Int32Array
  count: number
  /** Per-component palette label (TRANSPARENT_LABEL for transparent). */
  labels: Int32Array
  areas: Int32Array
}

/** 4-connected components of equal labels (two-pass union-find). */
export function connectedComponents(labels: LabelMap, width: number, height: number, scratch?: Int32Array): Components {
  const n = width * height
  // `scratch` (if given) is reused for the union-find array and becomes the
  // returned ids: repeated passes then allocate no new per-pixel memory.
  const parent = scratch && scratch.length >= n ? scratch.subarray(0, n) : new Int32Array(n)
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

  // Ids in place of the parent array (saves 8 bytes per pixel). Unions always
  // link to the smaller index and path compression points at the root, so a
  // set's root is its smallest index and every other pixel's parent is a
  // smaller index, whose slot already holds the set's id by the time it is
  // read. Ids come out numbered by first appearance, as before.
  const ids = parent
  let count = 0
  for (let p = 0; p < n; p++) {
    const par = parent[p]!
    ids[p] = par === p ? count++ : ids[par]!
  }
  checkpoint('connectedComponents')
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
 * Small regions that `mergeSmallRegions` keeps although they are under its
 * area threshold: real detail stands out from what surrounds it, noise does not.
 */
export interface DetailProtection {
  /** OKLab distance to the merge target at or above which a small region counts as detail. */
  contrast: number
  /** Detail regions at least this large (working px) are kept. */
  minArea: number
}

/**
 * Merges every component smaller than `minArea` into its best neighbour
 * (longest shared border, ties broken by color similarity). Updates `labels`
 * in place and returns it; callers re-run connectedComponents on it.
 * With `protect`, a small component that contrasts strongly with that
 * neighbour (a light gap between two dark outlines, a dot, a highlight) is
 * kept once it reaches `protect.minArea`. With `only`, just components
 * whose label passes it merge, and only into neighbours that pass it too.
 */
export function mergeSmallRegions(
  labels: LabelMap,
  width: number,
  height: number,
  palette: PaletteColor[],
  minArea: number,
  scratch?: Int32Array,
  protect?: DetailProtection,
  only?: (label: number) => boolean,
): LabelMap {
  const comps = connectedComponents(labels, width, height, scratch)
  const { ids, count } = comps
  const compLabel = comps.labels.slice()
  // With `only`, components of other labels never merge and never absorb
  // (they count as large, and are skipped as targets below).
  const areas = only ? comps.areas.map((a, c) => (only(compLabel[c]!) ? a : Math.max(a, minArea))) : comps.areas

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
      if (only && !only(compLabel[root]!)) continue
      const distance = colorDistance(palette, compLabel[c]!, compLabel[root]!)
      if (length > bestLength || (length === bestLength && distance < bestDistance)) {
        best = root
        bestLength = length
        bestDistance = distance
      }
    }
    if (best < 0) continue
    if (protect && area[c]! >= protect.minArea && bestDistance >= protect.contrast) continue

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

  // In place: each pixel's new label depends only on its own component id.
  for (let p = 0; p < labels.length; p++) labels[p] = compLabel[find(ids[p]!)]!
  return labels
}

/**
 * Dissolves "blend slivers": thin regions lying between two other colors
 * whose own color is (loosely) a blend of those two — anti-aliasing and JPEG
 * chroma fringes that survived labeling (e.g. a light-blue rim along black
 * text in a JPEG, a gray line between yellow and blue). Each sliver pixel
 * goes to whichever of the two neighbour colors it is closer to, which puts
 * the boundary back where the edge really is.
 *
 * Thin = area / boundary length below `maxHalfThickness` (a strip of
 * thickness t has area/boundary ≈ t/2). Kept: real strokes, which either have
 * one neighbour color on both sides (text, rings, outlines on a background)
 * or a color no blend of their neighbours explains (a black outline).
 */
export function dissolveBlendSlivers(
  labels: LabelMap,
  width: number,
  height: number,
  palette: PaletteColor[],
  lab: OklabSource,
  maxHalfThickness: number,
  scratch?: Int32Array,
): LabelMap {
  const comps = connectedComponents(labels, width, height, scratch)
  const { ids, count, areas } = comps
  const boundary = new Int32Array(count)
  const addEdge = (a: number, b: number) => {
    boundary[a] = boundary[a]! + 1
    boundary[b] = boundary[b]! + 1
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (x + 1 < width && ids[p] !== ids[p + 1]) addEdge(ids[p]!, ids[p + 1]!)
      if (y + 1 < height && ids[p] !== ids[p + width]) addEdge(ids[p]!, ids[p + width]!)
    }
  }
  const thin = new Uint8Array(count)
  let any = false
  for (let c = 0; c < count; c++) {
    if (comps.labels[c] === TRANSPARENT_LABEL || boundary[c] === 0) continue
    if (areas[c]! / boundary[c]! < maxHalfThickness) {
      thin[c] = 1
      any = true
    }
  }
  if (!any) return labels

  // Neighbour-label border counts for thin components only.
  const neighbourLabels = new Map<number, Map<number, number>>()
  const note = (c: number, label: number) => {
    if (!thin[c]) return
    let m = neighbourLabels.get(c)
    if (!m) {
      m = new Map()
      neighbourLabels.set(c, m)
    }
    m.set(label, (m.get(label) ?? 0) + 1)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const right = x + 1 < width ? p + 1 : -1
      const down = y + 1 < height ? p + width : -1
      for (const q of [right, down]) {
        if (q < 0 || ids[p] === ids[q]) continue
        note(ids[p]!, labels[q]!)
        note(ids[q]!, labels[p]!)
      }
    }
  }

  const rgb = (label: number): [number, number, number] => {
    const c = palette[label]!
    return [c.r / 255, c.g / 255, c.b / 255]
  }
  const replacement = new Map<number, [number, number]>()
  for (const [c, neighbours] of neighbourLabels) {
    const own = comps.labels[c]!
    const ranked = Array.from(neighbours.entries())
      .filter(([label]) => label !== own && label !== TRANSPARENT_LABEL)
      .sort((a, b) => b[1] - a[1])
    if (ranked.length < 2) continue
    const a = ranked[0]![0]
    const b = ranked[1]![0]
    const [ar, ag, ab] = rgb(a)
    const [br, bg, bb] = rgb(b)
    const [cr, cg, cb] = rgb(own)
    const dx = br - ar
    const dy = bg - ag
    const dz = bb - ab
    const len2 = dx * dx + dy * dy + dz * dz
    if (len2 === 0) continue
    const t = ((cr - ar) * dx + (cg - ag) * dy + (cb - ab) * dz) / len2
    if (t < 0.05 || t > 0.95) continue
    const residual = Math.hypot(ar + dx * t - cr, ag + dy * t - cg, ab + dz * t - cb)
    if (residual < 0.12) replacement.set(c, [a, b])
  }
  if (replacement.size === 0) return labels

  // In place: a pixel's new label depends only on its component and color.
  const out = labels
  for (let p = 0; p < out.length; p++) {
    const pair = replacement.get(ids[p]!)
    if (!pair) continue
    const L = lab.L(p)
    const A = lab.A(p)
    const B = lab.B(p)
    const [a, b] = pair
    const ca = palette[a]!
    const cb = palette[b]!
    const da = (L - ca.L) ** 2 + (A - ca.A) ** 2 + (B - ca.B) ** 2
    const db = (L - cb.L) ** 2 + (A - cb.A) ** 2 + (B - cb.B) ** 2
    out[p] = da <= db ? a : b
  }
  return out
}
