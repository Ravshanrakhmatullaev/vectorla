import type { Env } from '../env'
import type { UserPlan } from '../types'
import { ForbiddenError } from '../errors'
import type { ProfilesRepository } from '../repositories/ProfilesRepository'
import { createProfilesRepository } from '../repositories/createProfilesRepository'

export class ProfileService {
  constructor(private readonly profiles: ProfilesRepository) {}

  async getRequiredPlan(userId: string): Promise<UserPlan> {
    const plan = await this.profiles.findPlanByUserId(userId)
    if (!plan) throw new ForbiddenError('Authenticated user profile is not provisioned')
    return plan
  }
}

export function createProfileService(env: Env): ProfileService {
  return new ProfileService(createProfilesRepository(env))
}
