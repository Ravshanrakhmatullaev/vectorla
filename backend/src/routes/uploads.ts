import type { Env } from '../env'
import { createUploadService } from '../services/UploadService'
import { ValidationError, PayloadTooLargeError, UnsupportedMediaTypeError } from '../errors'
import { isUserPlan } from '../types'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** POST /api/uploads is implemented. GET/DELETE /api/uploads/:id are not yet (see UploadService). */
export async function handleUploadsRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: 'Expected multipart/form-data with a "file" field' }, 400)
  }

  // @cloudflare/workers-types' default FormData.get() is typed as string-only,
  // but the real Workers runtime does return File entries for multipart
  // form-data — this cast documents that known typing gap.
  const file = formData.get('file') as unknown as File | string | null
  const userId = formData.get('userId')
  const planField = formData.get('plan')

  if (!(file instanceof File)) {
    return jsonResponse({ error: 'Missing "file" field' }, 400)
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    return jsonResponse({ error: 'Missing "userId" field' }, 400)
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
    return jsonResponse(upload, 201)
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) return jsonResponse({ error: error.message }, 415)
    if (error instanceof PayloadTooLargeError) return jsonResponse({ error: error.message }, 413)
    if (error instanceof ValidationError) return jsonResponse({ error: error.message }, 400)
    console.error('Unexpected error in POST /api/uploads:', error)
    return jsonResponse({ error: 'Internal Server Error' }, 500)
  }
}
