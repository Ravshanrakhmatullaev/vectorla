import type { Env } from '../env'
import { createUploadService } from '../services/UploadService'
import { createJobService } from '../services/JobService'
import { createImageAnalysisService } from '../services/ImageAnalysisService'
import { createProfileService } from '../services/ProfileService'
import { createUsageLimitsService } from '../services/UsageLimitsService'
import type { UserPlan } from '../types'
import { requireAuth } from '../middleware/requireAuth'
import { jsonSuccess, jsonError, mapErrorToResponse } from '../api/response'
import { UnauthorizedError } from '../errors'
import { MAX_UPLOAD_BODY_BYTES, UPLOAD_ANALYSIS_MAX_BYTES } from '../config'
import { readLimitedBody, parseMultipart } from '../api/readLimitedBody'

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

  // Abuse limits before the body is read (services/UsageLimitsService.ts):
  // uploads per 10 minutes / per day and concurrent conversions.
  const limits = createUsageLimitsService(env)
  let plan: UserPlan
  try {
    plan = await createProfileService(env).getRequiredPlan(userId)
    await limits.assertCanStartUpload(userId, plan)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }

  // The body is read with a byte limit: a missing or false Content-Length
  // (chunked uploads) can't make the Worker buffer more than
  // MAX_UPLOAD_BODY_BYTES. The per-plan file limit is enforced after parsing.
  let formData: FormData | null
  try {
    let body: Uint8Array | null = await readLimitedBody(request, MAX_UPLOAD_BODY_BYTES)
    formData = await parseMultipart(body, request.headers.get('Content-Type'))
    body = null // the parsed form holds its own copy; let the raw body be collected
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
  if (!formData) {
    return jsonError('VALIDATION_ERROR', 'Expected multipart/form-data with a "file" field', 400, requestId)
  }

  // @cloudflare/workers-types' default FormData.get() is typed as string-only,
  // but the real Workers runtime does return File entries for multipart
  // form-data — this cast documents that known typing gap.
  const file = formData.get('file') as unknown as File | string | null

  if (!(file instanceof File)) {
    return jsonError('VALIDATION_ERROR', 'Missing "file" field', 400, requestId)
  }

  try {
    await limits.assertStorageAvailable(userId, plan, file.size)
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
    // Skipped for large files (UPLOAD_ANALYSIS_MAX_BYTES): the decode would
    // not fit in this request's memory next to two copies of the body.
    let analysis = null
    if (buffer.byteLength <= UPLOAD_ANALYSIS_MAX_BYTES) {
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
    }

    // Storage keys never reach clients (see routes/conversions.ts toPublicConversion).
    const { storageKey: _storageKey, ...publicUpload } = upload
    return jsonSuccess({ upload: publicUpload, job, analysis }, 201, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}
