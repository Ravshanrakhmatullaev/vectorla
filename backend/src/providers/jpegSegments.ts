/**
 * Drops JPEG marker segments the decoder doesn't need before the bytes are
 * copied into the decoder's WebAssembly memory. That memory grows to fit the
 * whole input and is a large share of a decode's peak: a 4 MP JPEG padded
 * to 30 MB with comment segments grew mozjpeg's memory to ~104 MB, against
 * ~51 MB for the same image unpadded.
 *
 * Kept: everything the decoder reads — tables, frame and scan headers, the
 * entropy-coded data (everything from the first SOS on, untouched) — plus
 * APP0 (JFIF), the first APP1 "Exif" segment (the decoder applies its
 * orientation) and APP14 (Adobe color transform). Dropped: COM, other APPn
 * (ICC profiles, XMP, vendor data), which the decoder ignores.
 *
 * Returns the input unchanged if nothing is dropped or the structure before
 * the first scan can't be walked (the decoder then reports the error).
 */
export function stripJpegMetadata(bytes: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(bytes)
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return bytes
  const keep: Array<[number, number]> = [[0, 2]]
  let dropped = 0
  let exifKept = false
  let scan = false
  let i = 2
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return bytes
    let start = i
    let marker = b[i + 1]!
    while (marker === 0xff && i + 2 < b.length) {
      i++
      start = i
      marker = b[i + 1]!
    }
    if (marker === 0xda) {
      keep.push([start, b.length]) // SOS: scans and everything after stay as they are
      scan = true
      break
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xd9) {
      keep.push([start, start + 2])
      i = start + 2
      continue
    }
    const end = start + 2 + ((b[start + 2]! << 8) | b[start + 3]!)
    if (end > b.length || end < start + 4) return bytes
    const isExif = marker === 0xe1 && !exifKept && end - start >= 10 && b[start + 4] === 0x45 && b[start + 5] === 0x78 && b[start + 6] === 0x69 && b[start + 7] === 0x66
    const drop = marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xee && !isExif)
    if (isExif) exifKept = true
    if (drop) dropped += end - start
    else keep.push([start, end])
    i = end
  }
  if (dropped === 0 || !scan) return bytes
  const out = new Uint8Array(b.length - dropped)
  let o = 0
  for (const [s, e] of keep) {
    out.set(b.subarray(s, e), o)
    o += e - s
  }
  return out.buffer.slice(0, o)
}
