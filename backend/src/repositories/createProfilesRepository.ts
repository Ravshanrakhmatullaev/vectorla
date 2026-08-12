import type { Env } from '../env'
import { shouldUseInMemoryRepositories } from '../env'
import { createSupabaseClient } from '../integrations/supabase'
import type { ProfilesRepository } from './ProfilesRepository'
import { InMemoryProfilesRepository } from './InMemoryProfilesRepository'
import { SupabaseProfilesRepository } from './SupabaseProfilesRepository'

const inMemoryRepositoryByEnv = new WeakMap<Env, InMemoryProfilesRepository>()

export function createProfilesRepository(env: Env): ProfilesRepository {
  if (shouldUseInMemoryRepositories(env)) {
    let repository = inMemoryRepositoryByEnv.get(env)
    if (!repository) {
      repository = new InMemoryProfilesRepository()
      inMemoryRepositoryByEnv.set(env, repository)
    }
    return repository
  }

  return new SupabaseProfilesRepository(createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY))
}
