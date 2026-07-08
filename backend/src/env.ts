import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from './integrations/queue'
import type { VectorizationProviderName } from './providers/VectorizationProvider'

/** Bindings + secrets declared in wrangler.toml — see that file for how each is provisioned. */
export interface Env {
  UPLOADS_BUCKET: R2Bucket
  CONVERSION_QUEUE: Queue<ConversionQueueMessage>
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  /** HMAC key for StorageService's self-signed download URLs (see StorageService.getSignedDownloadUrl). */
  DOWNLOAD_URL_SECRET: string
  /** Selects the VectorizationProvider ConversionService uses — see providers/ProviderFactory.ts. */
  VECTORIZATION_PROVIDER: VectorizationProviderName
  ENVIRONMENT: 'development' | 'staging' | 'production'
}
