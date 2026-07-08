import type { Job } from '../types'
import type { JobsRepository } from './JobsRepository'

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

  async update(job: Job): Promise<Job> {
    this.jobsById.set(job.id, job)
    return job
  }
}
