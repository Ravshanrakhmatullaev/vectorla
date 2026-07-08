import type { Env } from '../env'
import { createUploadService } from '../services/UploadService'
import { createJobService } from '../services/JobService'
import { requireAuth } from '../middleware/requireAuth'
import { jsonSuccess, jsonError, mapErrorToResponse } from '../api/response'
import { UnauthorizedError } from '../errors'
import { isUserPlan } from '../types'

/** POST /api/v1/uploads is implemented. GET/DELETE /api/v1/uploads/:id are not yet (see UploadService). */
export async function handleUploadsRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonError('VALIDATION_ERROR', 'Method not allowed', 405, requestId)
  }

  let userId: string
  try {
    ;({ userId } = await requireAuth(request, env))
  } catch (error) {
    if (error instanceof UnauthorizedError) return mapErrorToResponse(error, requestId)
    throw error
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonError('VALIDATION_ERROR', 'Expected multipart/form-data with a "file" field', 400, requestId)
  }

  // @cloudflare/workers-types' default FormData.get() is typed as string-only,
  // but the real Workers runtime does return File entries for multipart
  // form-data — this cast documents that known typing gap.
  const file = formData.get('file') as unknown as File | string | null
  const planField = formData.get('plan')

  if (!(file instanceof File)) {
    return jsonError('VALIDATION_ERROR', 'Missing "file" field', 400, requestId)
  }

  const plan = typeof planField === 'string' && isUserPlan(planField) ? planField : 'free'

  try {
    const buffer = await file.arrayBuffer()
    const uploadService = createUploadService(env)
    const upload = await uploadService.createUpload({
      userId,
      plan,
      file: buffer,
      originalFileName: file.name,
      mimeType: file.type,
    })

    // Goal of Phase 10: every successful upload automatically gets a
    // conversion job created and enqueued — no separate client call needed
    // (though POST /api/v1/jobs also exists for re-processing an existing upload).
    const jobService = createJobService(env)
    const job = await jobService.createJob({ userId, uploadId: upload.id })

    return jsonSuccess({ upload, job }, 201, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}
