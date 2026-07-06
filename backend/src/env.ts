import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from './integrations/queue'

/** Bindings + secrets declared in wrangler.toml — see that file for how each is provisioned. */
export interface Env {
  UPLOADS_BUCKET: R2Bucket
  CONVERSION_QUEUE: Queue<ConversionQueueMessage>
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  ENVIRONMENT: 'development' | 'staging' | 'production'
}
