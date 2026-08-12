import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserPlan } from '../types'
import { isUserPlan } from '../types'
import type { ProfilesRepository } from './ProfilesRepository'

interface ProfilePlanRow {
  plan: string
}

export class SupabaseProfilesRepository implements ProfilesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findPlanByUserId(userId: string): Promise<UserPlan | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('plan')
      .eq('id', userId)
      .maybeSingle<ProfilePlanRow>()

    if (error) throw new Error(`Failed to fetch authenticated profile: ${error.message}`)
    if (!data) return null
    if (!isUserPlan(data.plan)) throw new Error(`Profile for user "${userId}" has an invalid plan`)
    return data.plan
  }
}
