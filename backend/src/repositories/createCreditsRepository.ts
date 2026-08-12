import type { Env } from '../env'
import { shouldUseInMemoryRepositories } from '../env'
import { createSupabaseClient } from '../integrations/supabase'
import { SupabaseCreditsRepository } from './SupabaseCreditsRepository'
import { InMemoryCreditsRepository } from './InMemoryCreditsRepository'
import type { CreditsRepository } from './CreditsRepository'

// See createUploadsRepository.ts for why this cache exists — same reasoning
// applies here (CreditsService and any future route handler each call this
// factory independently and need to see the same in-memory store within one
// request/test).
const inMemoryRepositoryByEnv = new WeakMap<Env, InMemoryCreditsRepository>()

/** Same fallback pattern as createUploadsRepository — see that file for the rationale. */
export function createCreditsRepository(env: Env): CreditsRepository {
  if (shouldUseInMemoryRepositories(env)) {
    let repository = inMemoryRepositoryByEnv.get(env)
    if (!repository) {
      repository = new InMemoryCreditsRepository()
      inMemoryRepositoryByEnv.set(env, repository)
    }
    return repository
  }
  const client = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return new SupabaseCreditsRepository(client)
}
