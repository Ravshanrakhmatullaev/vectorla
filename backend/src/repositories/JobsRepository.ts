import type { Job } from '../types'

export interface JobsRepository {
  /** Throws ConflictError if the upload already has an active (queued/processing) job. */
  create(job: Job): Promise<Job>
  findById(id: string): Promise<Job | null>
  /**
   * Persists the full job object. Optimistic locking: `previous` must be the
   * job exactly as last read by the caller — implementations throw
   * ConflictError if the stored row has since changed (someone else updated
   * it first), so two concurrent transitions on the same job can't silently
   * clobber each other.
   */
  update(previous: Job, next: Job): Promise<Job>
  /** An upload's currently in-flight job (queued/processing), if any — used to prevent duplicate active jobs per upload. */
  findActiveByUploadId(uploadId: string): Promise<Job | null>
  findByUploadId(uploadId: string): Promise<Job[]>
  findPageByUserId(userId: string, limit: number, offset: number): Promise<{ jobs: Job[]; total: number }>
  /** Jobs in `status` whose updatedAt is older than `before` (ISO) — for the stale-job sweeper. */
  findStale(status: 'queued' | 'processing', before: string, limit: number): Promise<Job[]>
}
