import type { Env } from '../env'

/** Will handle: POST /api/uploads (create), GET /api/uploads/:id (fetch), DELETE /api/uploads/:id. */
export async function handleUploadsRoute(_request: Request, _env: Env): Promise<Response> {
  throw new Error('Not implemented')
}
