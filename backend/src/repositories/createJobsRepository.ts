import type { Env } from '../env'
import { shouldUseInMemoryRepositories } from '../env'
import { createSupabaseClient } from '../integrations/supabase'
import { SupabaseJobsRepository } from './SupabaseJobsRepository'
import { InMemoryJobsRepository } from './InMemoryJobsRepository'
import type { JobsRepository } from './JobsRepository'

// See createUploadsRepository.ts for why this cache exists — same reasoning
// applies here (JobService.createJob and the queue consumer's markProcessing/
// markCompleted/markFailed each call this factory independently and need to
// see the same in-memory store within one request/test).
const inMemoryRepositoryByEnv = new WeakMap<Env, InMemoryJobsRepository>()

/** Same fallback pattern as createUploadsRepository — see that file for the rationale. */
export function createJobsRepository(env: Env): JobsRepository {
  if (shouldUseInMemoryRepositories(env)) {
    let repository = inMemoryRepositoryByEnv.get(env)
    if (!repository) {
      repository = new InMemoryJobsRepository()
      inMemoryRepositoryByEnv.set(env, repository)
    }
    return repository
  }
  const client = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return new SupabaseJobsRepository(client)
}
