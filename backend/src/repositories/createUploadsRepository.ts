import type { Env } from '../env'
import { shouldUseInMemoryRepositories } from '../env'
import { createSupabaseClient } from '../integrations/supabase'
import { SupabaseUploadsRepository } from './SupabaseUploadsRepository'
import { InMemoryUploadsRepository } from './InMemoryUploadsRepository'
import type { UploadsRepository } from './UploadsRepository'

// Scoped to the in-memory fallback only: a real Supabase-backed repository
// never needs this, since every instance is a stateless client over the same
// external DB. But within one request/test, UploadService and JobService each
// call this factory independently — without a cache, JobService's in-memory
// store wouldn't see an upload UploadService just created in a different
// instance. Keying by the `env` object (stable within one Workers invocation)
// keeps that visible without affecting production at all.
const inMemoryRepositoryByEnv = new WeakMap<Env, InMemoryUploadsRepository>()

/**
 * Picks the real Supabase-backed repository when credentials are configured,
 * or falls back to an in-memory one otherwise (local `wrangler dev` without
 * `.dev.vars`, or a plain Node test script). Production always sets the two
 * secrets, so it always gets the real repository.
 */
export function createUploadsRepository(env: Env): UploadsRepository {
  if (shouldUseInMemoryRepositories(env)) {
    let repository = inMemoryRepositoryByEnv.get(env)
    if (!repository) {
      repository = new InMemoryUploadsRepository()
      inMemoryRepositoryByEnv.set(env, repository)
    }
    return repository
  }
  const client = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return new SupabaseUploadsRepository(client)
}
