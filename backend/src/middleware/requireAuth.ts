import type { Env } from '../env'
import type { AuthenticatedUser } from '../services/AuthService'
import { createAuthService } from '../services/AuthService'
import { UnauthorizedError } from '../errors'
import { isLocalDevelopment } from '../env'

const BEARER_PATTERN = /^Bearer\s+(.+)$/i

/**
 * Resolves the authenticated caller from `Authorization: Bearer <token>`,
 * verifying the token via AuthService (real Supabase Auth check). Throws
 * UnauthorizedError (routes map this to 401) when the header is missing or
 * malformed, or the token doesn't verify.
 *
 * Test/dev-only bypass: in development, a request with no Authorization
 * header but an `X-Test-User-Id` header is trusted as-is. This exists purely
 * so this repo's smoke tests (see routes/*.smoke-test.ts) can exercise
 * protected routes without a real Supabase project or real JWTs. It never
 * activates in staging/production, and a real Authorization header always
 * takes precedence when present.
 */
export async function requireAuth(request: Request, env: Env): Promise<AuthenticatedUser> {
  const authHeader = request.headers.get('Authorization')

  if (authHeader) {
    const match = BEARER_PATTERN.exec(authHeader)
    if (!match) throw new UnauthorizedError('Malformed Authorization header')
    const authService = createAuthService(env)
    return authService.verifyToken(match[1] ?? '')
  }

  if (isLocalDevelopment(env)) {
    const testUserId = request.headers.get('X-Test-User-Id')
    if (testUserId) return { userId: testUserId }
  }

  throw new UnauthorizedError('Missing Authorization header')
}
