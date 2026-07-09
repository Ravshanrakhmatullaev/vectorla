import { UnsupportedMediaTypeError } from '../errors'
import { init as initPngDecoder, default as decodePng } from '@jsquash/png/decode.js'
import { init as initJpegDecoder, default as decodeJpeg } from '@jsquash/jpeg/decode.js'
import { init as initWebpDecoder, default as decodeWebp } from '@jsquash/webp/decode.js'

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
  try {
    switch (mimeType) {
      case 'image/png':
        await initPngDecoder(wasm.png)
        return await decodePng(fileBytes)
      case 'image/jpeg':
        await initJpegDecoder(wasm.jpeg)
        return await decodeJpeg(fileBytes)
      case 'image/webp':
        await initWebpDecoder(wasm.webp)
        return await decodeWebp(fileBytes)
      default:
        throw new UnsupportedMediaTypeError(`Cannot vectorize unsupported mime type "${mimeType}"`)
    }
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to decode ${mimeType} image: ${reason}`)
  }
}
