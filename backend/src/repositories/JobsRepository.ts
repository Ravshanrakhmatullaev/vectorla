import type { Job } from '../types'

export interface JobsRepository {
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
}
