import { PayloadTooLargeError, UnsupportedMediaTypeError } from '../errors'
import { assertDecodableDimensions } from './imageDimensions'
import { decodePngFresh } from './pngDecoder'
import { stripJpegMetadata } from './jpegSegments'
import { initEmscriptenModule as initJpegModule } from '@jsquash/jpeg/utils.js'
import mozjpegDecoder from '@jsquash/jpeg/codec/dec/mozjpeg_dec.js'
import { initEmscriptenModule as initWebpModule } from '@jsquash/webp/utils.js'
import webpDecoder from '@jsquash/webp/codec/dec/webp_dec.js'
import { fitWorkingSize, workingPixelCap, type TraceEngineOptions } from '../engine/traceImage'
import { checkpoint } from '../engine/memoryCheckpoint'
import type { RgbaImage } from '../engine/raster'

// Workers has no ImageData. The JPEG and WebP decoder glue each define a
// polyfill on first use, from inside a decoder instance's closure, so that
// global would keep the first decoder instance and its WebAssembly memory
// (~19 MB after a 4 MP JPEG) alive for the life of the isolate. Defining it
// here first, at module scope, keeps every decoder instance collectable.
if (!(globalThis as { ImageData?: unknown }).ImageData) {
  ;(globalThis as { ImageData?: unknown }).ImageData = class ImageData {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }
}

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
    // Every decode gets its own decoder instance, dropped when it returns: a
    // WebAssembly memory grows to fit the largest image decoded and never
    // shrinks, so a kept instance (jsquash's default) holds 19-51 MB after a
    // 4 MP image, and even a freshly re-initialized one holds ~32 MB.
    switch (mimeType) {
      case 'image/png': {
        const image = decodePngFresh(wasm.png, fileBytes)
        checkpoint('decoder')
        return image
      }
      case 'image/jpeg': {
        const decoder = await initJpegModule(mozjpegDecoder, wasm.jpeg)
        // preserveOrientation false: EXIF orientation is applied (as jsquash's decode() default).
        const image = decoder.decode(stripJpegMetadata(fileBytes), false)
        checkpoint('decoder')
        if (!image) throw new Error('Decoding error')
        return image
      }
      case 'image/webp': {
        const decoder = await initWebpModule(webpDecoder, wasm.webp)
        const image = decoder.decode(fileBytes)
        checkpoint('decoder')
        if (!image) throw new Error('Decoding error')
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
  /** Taken (set to null) by traceOwnedImage, so the pixels can be freed mid-trace. */
  image: RgbaImage | null
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
  caps: Pick<TraceEngineOptions, 'maxWorkingPixels' | 'photoMaxWorkingPixels'> & Partial<Pick<TraceEngineOptions, 'maxUpscaledPixels'>>,
  inspect?: (full: ImageData) => void,
): Promise<DecodedForTrace> {
  const full = await decodeImage(mimeType, fileBytes, wasm)
  checkpoint('decoded')
  inspect?.(full)
  return { image: fitWorkingSize(full, workingPixelCap(full, caps)), sourceSize: { width: full.width, height: full.height } }
}
