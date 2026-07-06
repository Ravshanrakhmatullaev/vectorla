import type { Env } from '../env'

/** Will handle: POST /api/jobs (create + enqueue), GET /api/jobs/:id (poll status). */
export async function handleJobsRoute(_request: Request, _env: Env): Promise<Response> {
  throw new Error('Not implemented')
}
