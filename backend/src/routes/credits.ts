import type { Env } from '../env'

/** Will handle: GET /api/credits (current balance + recent transactions). */
export async function handleCreditsRoute(_request: Request, _env: Env): Promise<Response> {
  throw new Error('Not implemented')
}
