import { apiPostForm } from '@/lib/api/client'
import type { UploadResult } from '@/lib/api/types'

/** POST /api/v1/uploads — see backend/API.md. Also auto-creates the conversion job. */
export function uploadImage(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  return apiPostForm<UploadResult>('/api/v1/uploads', form)
}
