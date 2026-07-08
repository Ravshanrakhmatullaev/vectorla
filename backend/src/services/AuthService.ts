import type { SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../env'
import { createSupabaseClient } from '../integrations/supabase'
import { UnauthorizedError } from '../errors'

export interface AuthenticatedUser {
  userId: string
}

/**
 * Verifies Supabase-issued JWTs. Delegates verification to Supabase's Auth
 * server via supabase-js's `auth.getUser(token)` rather than checking the
 * JWT signature locally — no extra dependency or secret beyond the Supabase
 * credentials this codebase already has, and it stays correct if a token is
 * revoked/banned mid-session, at the cost of one network round-trip per
 * authenticated request. See requireAuth.ts for how this plugs into routes.
 */
export class AuthService {
  constructor(private readonly client: SupabaseClient) {}

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    const { data, error } = await this.client.auth.getUser(token)
    if (error || !data.user) {
      throw new UnauthorizedError('Invalid or expired token')
    }
    return { userId: data.user.id }
  }
}

export function createAuthService(env: Env): AuthService {
  const client = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return new AuthService(client)
}
