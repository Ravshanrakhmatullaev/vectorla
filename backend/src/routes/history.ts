import type { Env } from '../env'
import { NotImplementedError } from '../errors'

/** Will handle: GET /api/v1/history (paginated past jobs + conversions for the caller). */
export async function handleHistoryRoute(_request: Request, _env: Env, _requestId: string): Promise<Response> {
  throw new NotImplementedError('GET /api/v1/history is not implemented yet')
}
