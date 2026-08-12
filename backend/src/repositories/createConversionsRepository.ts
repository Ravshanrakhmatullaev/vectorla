import type { Env } from '../env'
import { shouldUseInMemoryRepositories } from '../env'
import { createSupabaseClient } from '../integrations/supabase'
import { SupabaseConversionsRepository } from './SupabaseConversionsRepository'
import { InMemoryConversionsRepository } from './InMemoryConversionsRepository'
import type { ConversionsRepository } from './ConversionsRepository'

// See createUploadsRepository.ts for why this cache exists — same reasoning
// applies here (ConversionService and any future route handler each call this
// factory independently and need to see the same in-memory store within one
// request/test).
const inMemoryRepositoryByEnv = new WeakMap<Env, InMemoryConversionsRepository>()

/** Same fallback pattern as createUploadsRepository — see that file for the rationale. */
export function createConversionsRepository(env: Env): ConversionsRepository {
  if (shouldUseInMemoryRepositories(env)) {
    let repository = inMemoryRepositoryByEnv.get(env)
    if (!repository) {
      repository = new InMemoryConversionsRepository()
      inMemoryRepositoryByEnv.set(env, repository)
    }
    return repository
  }
  const client = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return new SupabaseConversionsRepository(client)
}
