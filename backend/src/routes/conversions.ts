import type { Env } from '../env'

/** Will handle: GET /api/conversions/:id (metadata + signed download URL). */
export async function handleConversionsRoute(_request: Request, _env: Env): Promise<Response> {
  throw new Error('Not implemented')
}
