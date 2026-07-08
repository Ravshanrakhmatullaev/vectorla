import { apiGet } from '@/lib/api/client'
import type { Job, JobConversionResult } from '@/lib/api/types'

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
