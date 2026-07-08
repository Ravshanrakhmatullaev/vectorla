import type { Env } from '../env'
import { NotImplementedError } from '../errors'

/** Will handle: GET /api/v1/credits (current balance + recent transactions). */
export async function handleCreditsRoute(_request: Request, _env: Env, _requestId: string): Promise<Response> {
  throw new NotImplementedError('GET /api/v1/credits is not implemented yet')
}
