import type { Env } from '../env'
import { createUploadService } from '../services/UploadService'
import { createJobService } from '../services/JobService'
import { createImageAnalysisService } from '../services/ImageAnalysisService'
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

    // Phase 21: analysis is computed here so the frontend gets it immediately
    // (before the queue even picks the job up), and again inside
    // ConversionService.processJob to actually pick a provider — both calls
    // are cheap/stateless, so this isn't persisted anywhere (see
    // ImageAnalysisService's doc comment for why that's an intentional
    // trade-off). Best-effort only: a decode failure here must not fail the
    // upload itself — validateFileSignature already checked the magic bytes,
    // but a truncated/corrupt-past-the-header file can still fail to decode;
    // that's exactly the kind of error the queue consumer already handles
    // gracefully (markFailed) when processJob decodes the same file for real.
    let analysis = null
    try {
      const imageAnalysisService = createImageAnalysisService({
        png: env.PNG_DECODER_WASM,
        jpeg: env.JPEG_DECODER_WASM,
        webp: env.WEBP_DECODER_WASM,
      })
      analysis = await imageAnalysisService.analyze(upload, buffer)
    } catch (error) {
      console.error(`[${requestId}] Upload-time image analysis failed for upload "${upload.id}" — continuing without it:`, error)
    }

    return jsonSuccess({ upload, job, analysis }, 201, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}
