import type { Env } from '../env'

/** Will handle: GET /api/history (paginated past jobs + conversions for the caller). */
export async function handleHistoryRoute(_request: Request, _env: Env): Promise<Response> {
  throw new Error('Not implemented')
}
