import type { Env } from '../env'

/** Will handle: GET /api/health (uptime/dependency check). Stubbed like every other route for now. */
export async function handleHealthRoute(_request: Request, _env: Env): Promise<Response> {
  throw new Error('Not implemented')
}
