import { PayloadTooLargeError, ValidationError } from '../errors'
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from '../config'

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Reads pixel dimensions from an image header WITHOUT decoding it.
 *
 * Decompression-bomb protection: a few-megabyte PNG can legally declare
 * 30000x30000 pixels, which would need ~3.6 GB of RGBA to decode — far past
 * a Worker's 128 MB. Every decode path checks these header dimensions first
 * (see assertDecodableDimensions), so the expensive allocation never starts.
 *
 * Returns null if the header can't be parsed; callers treat that as invalid.
 */
export function readImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | null {
  switch (mimeType) {
    case 'image/png':
      return readPng(bytes)
    case 'image/jpeg':
      return readJpeg(bytes)
    case 'image/webp':
      return readWebp(bytes)
    default:
      return null
  }
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
const u32be = (b: Uint8Array, i: number) => (((b[i] ?? 0) << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0)
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
const u24le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16)

/** PNG: signature (8) + IHDR chunk length (4) + "IHDR" (4) + width (4) + height (4). */
function readPng(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null // "IHDR"
  return { width: u32be(b, 16), height: u32be(b, 20) }
}

/** JPEG: walk marker segments to the first SOFn frame header. */
function readJpeg(b: Uint8Array): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null
    let marker = b[i + 1]!
    // Fill bytes: any number of 0xFF may precede a marker.
    while (marker === 0xff && i + 2 < b.length) {
      i++
      marker = b[i + 1]!
    }
    // Standalone markers without a length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // EOI / start of scan before any frame header
    const length = u16be(b, i + 2)
    if (length < 2) return null
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (i + 9 > b.length) return null
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) }
    }
    i += 2 + length
  }
  return null
}

/** WebP: RIFF container with a VP8 (lossy), VP8L (lossless) or VP8X (extended) first chunk. */
function readWebp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
  if (chunk === 'VP8X') {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ') {
    // Frame tag (3 bytes) + start code 9d 01 2a, then 14-bit width/height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  return null
}

/**
 * Upload-time variant: rejects only headers that are readable AND declare an
 * oversized image. Unreadable headers are left to the decoder, which runs
 * assertDecodableDimensions before allocating anything.
 */
export function assertDimensionsWithinLimits(bytes: ArrayBuffer | Uint8Array, mimeType: string): void {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (readImageDimensions(view, mimeType)) assertDecodableDimensions(view, mimeType)
}

/**
 * Throws unless the image header declares a size this service can safely
 * decode: PayloadTooLargeError (HTTP 413) for oversized images,
 * ValidationError (HTTP 400) for unreadable or zero-sized headers.
 */
export function assertDecodableDimensions(bytes: ArrayBuffer | Uint8Array, mimeType: string): ImageDimensions {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const dimensions = readImageDimensions(view, mimeType)
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new ValidationError('Could not read image dimensions from the file header')
  }
  const { width, height } = dimensions
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new PayloadTooLargeError(
      `Image is ${width}x${height} pixels; the maximum is ${MAX_IMAGE_PIXELS / 1_000_000} megapixels and ${MAX_IMAGE_DIMENSION} px per side`,
    )
  }
  return dimensions
}
