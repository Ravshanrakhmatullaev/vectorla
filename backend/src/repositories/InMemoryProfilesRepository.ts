import type { UserPlan } from '../types'
import type { ProfilesRepository } from './ProfilesRepository'

/** Local-only profile source for fake development identities and smoke tests. */
export class InMemoryProfilesRepository implements ProfilesRepository {
  async findPlanByUserId(_userId: string): Promise<UserPlan> {
    return 'free'
  }
}
