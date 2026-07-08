import type { Job } from '../types'

export interface JobsRepository {
  create(job: Job): Promise<Job>
  findById(id: string): Promise<Job | null>
  /** Persists the full job object — callers (JobService) build the updated shape. */
  update(job: Job): Promise<Job>
}
