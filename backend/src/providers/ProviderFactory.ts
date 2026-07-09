import type { Env } from '../env'
import type { VectorizationProvider, VectorizationProviderName } from './VectorizationProvider'
import { isVectorizationProviderName } from './VectorizationProvider'
import type { RasterDecoderWasm } from './imageDecoder'
import { PlaceholderProvider } from './PlaceholderProvider'
import { PotraceProvider } from './PotraceProvider'
import { VisionProvider } from './VisionProvider'
import { OpenAIProvider } from './OpenAIProvider'

/**
 * Constructs a specific named provider (Phase 21) — the piece both
 * createVectorizationProvider (below, the static env-configured default) and
 * ConversionService (per-job dynamic selection via ProviderSelector) share,
 * so there's exactly one place that maps a name to a real instance.
 */
export function createProviderByName(name: VectorizationProviderName, decoderWasm: RasterDecoderWasm): VectorizationProvider {
  switch (name) {
    case 'placeholder':
      return new PlaceholderProvider(decoderWasm)
    case 'potrace':
      return new PotraceProvider()
    case 'vision':
      return new VisionProvider()
    case 'openai':
      return new OpenAIProvider()
  }
}

/**
 * Selects a VectorizationProvider from env.VECTORIZATION_PROVIDER (see
 * wrangler.toml). Falls back to PlaceholderProvider — the only one that
 * actually works today — for an unset or unrecognized value, so a
 * misconfigured var degrades to the safe default instead of breaking the
 * pipeline. Used as ConversionService's fallback when ProviderSelector's
 * per-job pick (Phase 21) turns out to still be an unimplemented stub.
 */
export function createVectorizationProvider(env: Env): VectorizationProvider {
  const decoderWasm = { png: env.PNG_DECODER_WASM, jpeg: env.JPEG_DECODER_WASM, webp: env.WEBP_DECODER_WASM }
  const name = env.VECTORIZATION_PROVIDER
  if (!isVectorizationProviderName(name)) {
    console.error(`Unknown VECTORIZATION_PROVIDER "${name}" — falling back to "placeholder"`)
    return new PlaceholderProvider(decoderWasm)
  }
  return createProviderByName(name, decoderWasm)
}
