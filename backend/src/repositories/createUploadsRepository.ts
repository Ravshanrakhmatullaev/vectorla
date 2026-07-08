import type { Env } from '../env'
import { createSupabaseClient } from '../integrations/supabase'
import { SupabaseUploadsRepository } from './SupabaseUploadsRepository'
import { InMemoryUploadsRepository } from './InMemoryUploadsRepository'
import type { UploadsRepository } from './UploadsRepository'

/**
 * Picks the real Supabase-backed repository when credentials are configured,
 * or falls back to an in-memory one otherwise (local `wrangler dev` without
 * `.dev.vars`, or a plain Node test script). Production always sets the two
 * secrets, so it always gets the real repository.
 */
export function createUploadsRepository(env: Env): UploadsRepository {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return new InMemoryUploadsRepository()
  }
  const client = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return new SupabaseUploadsRepository(client)
}
