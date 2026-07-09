import { apiGet, apiPostJson } from '@/lib/api/client'
import type { Job, JobConversionResult } from '@/lib/api/types'

/**
 * POST /api/v1/jobs — creates (or resumes) a conversion job for an existing
 * upload. Passing `preset: PROFESSIONAL_TRACE_PRESET` (see useUploadFlow.ts)
 * routes the job through the backend's Professional Trace pipeline instead
 * of the normal Quick Trace flow. `supersedesJobId` — the id of an
 * already-*completed* job for the same upload that this one replaces (e.g.
 * switching trace mode after a result already exists) — gets that job's
 * credit debit refunded first, so switching modes is never additive on top
 * of a prior charge. See backend/API.md.
 */
export function createJob(uploadId: string, preset?: string, supersedesJobId?: string): Promise<Job> {
  return apiPostJson<Job>('/api/v1/jobs', { uploadId, preset, supersedesJobId })
}

/** GET /api/v1/jobs/:id — see backend/API.md. */
export function getJob(jobId: string): Promise<Job> {
  return apiGet<Job>(`/api/v1/jobs/${jobId}`)
}

/**
 * GET /api/v1/jobs/:id/conversion — resolves a job to its result. Unlike most
 * endpoints, the 202 (still working) and 410 (failed) statuses are still a
 * *success* envelope (the request correctly reported the job's true state),
 * so apiGet returns normally in every case — callers branch on `status`.
 */
export function getJobConversion(jobId: string): Promise<JobConversionResult> {
  return apiGet<JobConversionResult>(`/api/v1/jobs/${jobId}/conversion`)
}
