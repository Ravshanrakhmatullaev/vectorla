import type { UserPlan } from '../types'

export interface ProfilesRepository {
  findPlanByUserId(userId: string): Promise<UserPlan | null>
}
