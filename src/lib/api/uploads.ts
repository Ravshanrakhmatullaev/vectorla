import { apiPostForm } from '@/lib/api/client'
import type { UploadResult } from '@/lib/api/types'

/**
 * POST /api/v1/uploads — see backend/API.md. Also auto-creates the conversion
 * job; `preset: PROFESSIONAL_TRACE_PRESET` (see useUploadFlow.ts) makes it a
 * Professional Trace job instead of Quick.
 */
export function uploadImage(file: File, preset?: string): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  if (preset) form.append('preset', preset)
  return apiPostForm<UploadResult>('/api/v1/uploads', form)
}
