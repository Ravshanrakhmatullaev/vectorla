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
    // Mirrors the jobs_one_active_per_upload partial unique index.
    // Synchronous check-and-set (no await in between), so it is atomic.
    if ((job.status === 'queued' || job.status === 'processing') && this.activeFor(job.uploadId)) {
      throw new ConflictError(`Upload "${job.uploadId}" already has an active job`)
    }
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
    return this.activeFor(uploadId)
  }

  async countActiveByUser(userId: string): Promise<number> {
    let count = 0
    for (const job of this.jobsById.values()) if (job.userId === userId && (job.status === 'queued' || job.status === 'processing')) count++
    return count
  }

  async findByUploadId(uploadId: string): Promise<Job[]> {
    return Array.from(this.jobsById.values()).filter((job) => job.uploadId === uploadId)
  }

  private activeFor(uploadId: string): Job | null {
    for (const job of this.jobsById.values()) {
      if (job.uploadId === uploadId && (job.status === 'queued' || job.status === 'processing')) {
        return job
      }
    }
    return null
  }

  async findStale(status: 'queued' | 'processing', before: string, limit: number): Promise<Job[]> {
    return Array.from(this.jobsById.values())
      .filter((job) => job.status === status && job.updatedAt < before)
      .slice(0, limit)
  }

  async findPageByUserId(userId: string, limit: number, offset: number): Promise<{ jobs: Job[]; total: number }> {
    const jobs = Array.from(this.jobsById.values())
      .filter((job) => job.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    return { jobs: jobs.slice(offset, offset + limit), total: jobs.length }
  }
}
