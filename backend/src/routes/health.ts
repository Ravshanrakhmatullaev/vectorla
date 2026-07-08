import type { Env } from '../env'
import { jsonSuccess } from '../api/response'

/** GET /api/v1/health — a real liveness check (Phase 21): no dependency checks yet, just confirms the Worker is up and routing. */
export async function handleHealthRoute(_request: Request, env: Env, requestId: string): Promise<Response> {
  return jsonSuccess({ status: 'ok', environment: env.ENVIRONMENT, timestamp: new Date().toISOString() }, 200, requestId)
}
