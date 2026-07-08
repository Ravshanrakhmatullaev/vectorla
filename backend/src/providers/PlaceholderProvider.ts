import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'

/**
 * The only provider that actually works today — produces a static "Vectorla
 * Preview" SVG regardless of input, so the full pipeline (queue ->
 * processing -> storage -> metadata -> completed) can be exercised
 * end-to-end without a real tracing/AI engine. See PotraceProvider,
 * VisionProvider, OpenAIProvider for the (currently stubbed) real options.
 */
export class PlaceholderProvider implements VectorizationProvider {
  readonly name = 'placeholder'

  async vectorize(_upload: Upload): Promise<VectorizationResult> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f4f4f5"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="28" fill="#18181b">Vectorla Preview</text>
</svg>`
    return {
      data: new TextEncoder().encode(svg).buffer as ArrayBuffer,
      format: 'svg',
    }
  }
}
