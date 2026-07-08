import type { SupabaseClient } from '@supabase/supabase-js'
import type { Job, JobStatus } from '../types'
import type { JobsRepository } from './JobsRepository'
import { ConflictError } from '../errors'

// Mirrors backend/supabase/schema.sql's `jobs` table exactly.
interface JobRow {
  id: string
  user_id: string
  upload_id: string
  status: string
  preset: string | null
  settings: Record<string, number> | null
  error_message: string | null
  retry_count: number
  version: number
  created_at: string
  updated_at: string
  completed_at: string | null
}

function mapRowToJob(row: JobRow): Job {
  return {
    id: row.id,
    userId: row.user_id,
    uploadId: row.upload_id,
    status: row.status as JobStatus,
    preset: row.preset,
    settings: row.settings,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

/** Real Supabase-backed implementation — used whenever SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are configured (see createJobsRepository). */
export class SupabaseJobsRepository implements JobsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(job: Job): Promise<Job> {
    const { data, error } = await this.client
      .from('jobs')
      .insert({
        id: job.id,
        user_id: job.userId,
        upload_id: job.uploadId,
        status: job.status,
        preset: job.preset,
        settings: job.settings,
        error_message: job.errorMessage,
        retry_count: job.retryCount,
        version: job.version,
      })
      .select()
      .single<JobRow>()

    if (error) throw new Error(`Failed to save job: ${error.message}`)
    return mapRowToJob(data)
  }

  async findById(id: string): Promise<Job | null> {
    const { data, error } = await this.client.from('jobs').select().eq('id', id).maybeSingle<JobRow>()
    if (error) throw new Error(`Failed to fetch job: ${error.message}`)
    return data ? mapRowToJob(data) : null
  }

  /** Optimistic locking via `version`: the conditional WHERE only matches if nobody updated the row since `previous` was read. */
  async update(previous: Job, next: Job): Promise<Job> {
    const { data, error } = await this.client
      .from('jobs')
      .update({
        status: next.status,
        error_message: next.errorMessage,
        retry_count: next.retryCount,
        version: next.version,
        updated_at: next.updatedAt,
        completed_at: next.completedAt,
      })
      .eq('id', next.id)
      .eq('version', previous.version)
      .select()
      .maybeSingle<JobRow>()

    if (error) throw new Error(`Failed to update job: ${error.message}`)
    if (!data) {
      throw new ConflictError(`Job "${next.id}" was modified concurrently — refusing a stale update`)
    }
    return mapRowToJob(data)
  }

  async findActiveByUploadId(uploadId: string): Promise<Job | null> {
    const { data, error } = await this.client
      .from('jobs')
      .select()
      .eq('upload_id', uploadId)
      .in('status', ['queued', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<JobRow>()

    if (error) throw new Error(`Failed to look up active job: ${error.message}`)
    return data ? mapRowToJob(data) : null
  }
}
