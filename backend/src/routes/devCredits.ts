import type { Env } from '../env'
import { createCreditsService } from '../services/CreditsService'
import { jsonSuccess, jsonError, mapErrorToResponse } from '../api/response'
import { NotFoundError } from '../errors'
import { isLocalDevelopment } from '../env'

interface DevCreditsGrantBody {
  userId?: unknown
  amount?: unknown
}

/**
 * POST /api/v1/dev/credits/grant — dev-only escape hatch (Phase 27) to fund a
 * test user's credit balance without real billing, since there's no payment/
 * credit lifecycle yet to grant credits any other way (see backend/README.md's
 * Pricing & Credits — CreditsService.grantMonthlyCredits/credit are otherwise
 * only ever called internally). Returns 404 in staging/production — as if the
 * route doesn't exist at all — rather than 403, so it never hints at its own
 * existence outside development, mirroring how requireAuth's X-Test-User-Id
 * bypass is scoped (see middleware/requireAuth.ts).
 */
export async function handleDevCreditsGrantRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!isLocalDevelopment(env)) {
    return mapErrorToResponse(new NotFoundError('No route for "/api/v1/dev/credits/grant"'), requestId)
  }
  if (request.method !== 'POST') {
    return jsonError('VALIDATION_ERROR', 'Method not allowed', 405, requestId)
  }

  let body: DevCreditsGrantBody
  try {
    body = (await request.json()) as DevCreditsGrantBody
  } catch {
    return jsonError('VALIDATION_ERROR', 'Expected a JSON body', 400, requestId)
  }

  if (typeof body.userId !== 'string' || body.userId.length === 0) {
    return jsonError('VALIDATION_ERROR', 'Missing "userId" field', 400, requestId)
  }
  if (typeof body.amount !== 'number' || !Number.isInteger(body.amount) || body.amount <= 0) {
    return jsonError('VALIDATION_ERROR', '"amount" must be a positive integer', 400, requestId)
  }

  try {
    const creditsService = createCreditsService(env)
    const transaction = await creditsService.credit(body.userId, body.amount, 'Dev credits grant (POST /api/v1/dev/credits/grant)')
    return jsonSuccess(transaction, 201, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}
