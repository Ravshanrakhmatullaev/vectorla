import type { Job } from '../types'
import type { JobsRepository } from './JobsRepository'
import { ConflictError } from '../errors'

/**
 * In-memory fallback used automatically when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
 * aren't configured (see createJobsRepository) — makes the job flow testable
 * locally without a real Supabase project. Not suitable for production, same
 * caveat as InMemoryUploadsRepository.
 */
export class InMemoryJobsRepository implements JobsRepository {
  private readonly jobsById = new Map<string, Job>()

  async create(job: Job): Promise<Job> {
    this.jobsById.set(job.id, job)
    return job
  }

  async findById(id: string): Promise<Job | null> {
    return this.jobsById.get(id) ?? null
  }

  async update(previous: Job, next: Job): Promise<Job> {
    const current = this.jobsById.get(previous.id)
    if (!current || current.version !== previous.version) {
      throw new ConflictError(`Job "${previous.id}" was modified concurrently — refusing a stale update`)
    }
    this.jobsById.set(next.id, next)
    return next
  }

  async findActiveByUploadId(uploadId: string): Promise<Job | null> {
    for (const job of this.jobsById.values()) {
      if (job.uploadId === uploadId && (job.status === 'queued' || job.status === 'processing')) {
        return job
      }
    }
    return null
  }
}
