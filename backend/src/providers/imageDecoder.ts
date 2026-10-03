import { PayloadTooLargeError, UnsupportedMediaTypeError } from '../errors'
import { assertDecodableDimensions } from './imageDimensions'
import { init as initPngDecoder, default as decodePng } from '@jsquash/png/decode.js'
import { init as initJpegDecoder, default as decodeJpeg } from '@jsquash/jpeg/decode.js'
import { init as initWebpDecoder, default as decodeWebp } from '@jsquash/webp/decode.js'
import { fitWorkingSize } from '../engine/traceImage'
import type { RgbaImage } from '../engine/raster'

export interface RasterDecoderWasm {
  png: WebAssembly.Module
  jpeg: WebAssembly.Module
  webp: WebAssembly.Module
}

/**
 * Shared PNG/JPEG/WEBP -> ImageData decode (Phase 21) — extracted out of
 * PlaceholderProvider so ImageAnalysisService can decode once and reuse the
 * exact same pixels PlaceholderProvider itself traces, without a second
 * dependency on "some provider" existing first (analysis has to happen
 * before a provider is even chosen — see providers/ProviderSelector.ts).
 */
export async function decodeImage(mimeType: string, fileBytes: ArrayBuffer, wasm: RasterDecoderWasm): Promise<ImageData> {
  // Header check before any allocation: every decode (upload-time analysis
  // and queue processing) passes through here, so no path can be bombed.
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp') {
    try {
      assertDecodableDimensions(fileBytes, mimeType)
    } catch (error) {
      if (error instanceof PayloadTooLargeError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to decode ${mimeType} image: ${reason}`)
    }
  }
  try {
    // Each decoder instance's WebAssembly memory grows to fit the largest
    // image it has decoded and never shrinks, and the decoder module keeps
    // its last instance. Re-initializing after the decode drops that
    // instance, so ~15 MB (4 MP JPEG) is not held through the trace.
    switch (mimeType) {
      case 'image/png': {
        await initPngDecoder(wasm.png)
        const image = await decodePng(fileBytes)
        await initPngDecoder(wasm.png)
        return image
      }
      case 'image/jpeg': {
        await initJpegDecoder(wasm.jpeg)
        const image = await decodeJpeg(fileBytes)
        await initJpegDecoder(wasm.jpeg)
        return image
      }
      case 'image/webp': {
        await initWebpDecoder(wasm.webp)
        const image = await decodeWebp(fileBytes)
        await initWebpDecoder(wasm.webp)
        return image
      }
      default:
        throw new UnsupportedMediaTypeError(`Cannot vectorize unsupported mime type "${mimeType}"`)
    }
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to decode ${mimeType} image: ${reason}`)
  }
}

/** A decoded upload already reduced to the engine's working size. */
export interface DecodedForTrace {
  image: RgbaImage
  /** The upload's real size, passed to traceImage as `sourceSize`. */
  sourceSize: { width: number; height: number }
}

/**
 * Decodes an upload and immediately reduces it to the engine's working size,
 * so the full-resolution pixels (16 MB for a 4 MP image) are garbage before
 * tracing starts instead of staying alive through it. A Worker isolate has
 * 128 MB in total; see BENCHMARKS.md "Memory". `inspect` sees the
 * full-resolution image first (image analysis).
 */
export async function decodeForTrace(
  mimeType: string,
  fileBytes: ArrayBuffer,
  wasm: RasterDecoderWasm,
  maxWorkingPixels: number,
  inspect?: (full: ImageData) => void,
): Promise<DecodedForTrace> {
  const full = await decodeImage(mimeType, fileBytes, wasm)
  inspect?.(full)
  return { image: fitWorkingSize(full, maxWorkingPixels), sourceSize: { width: full.width, height: full.height } }
}
