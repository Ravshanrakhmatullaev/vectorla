import type { HistoryEntry } from '../types'
import type { JobsRepository } from '../repositories/JobsRepository'
import type { ConversionsRepository } from '../repositories/ConversionsRepository'
import { createJobsRepository } from '../repositories/createJobsRepository'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import type { Env } from '../env'

export interface HistoryPage {
  entries: HistoryEntry[]
  total: number
}

export class HistoryService {
  constructor(
    private readonly jobs: JobsRepository,
    private readonly conversions: ConversionsRepository,
  ) {}

  async listUserHistory(userId: string, limit: number, offset: number): Promise<HistoryPage> {
    const { jobs, total } = await this.jobs.findPageByUserId(userId, limit, offset)
    const conversions = await this.conversions.findByJobIds(jobs.map((job) => job.id), userId)
    const conversionIdsByJobId = new Map<string, string[]>()

    for (const conversion of conversions) {
      const ids = conversionIdsByJobId.get(conversion.jobId) ?? []
      ids.push(conversion.id)
      conversionIdsByJobId.set(conversion.jobId, ids)
    }

    return {
      entries: jobs.map((job) => ({
        id: job.id,
        userId: job.userId,
        jobId: job.id,
        uploadId: job.uploadId,
        conversionIds: conversionIdsByJobId.get(job.id) ?? [],
        createdAt: job.createdAt,
      })),
      total,
    }
  }
}

export function createHistoryService(env: Env): HistoryService {
  return new HistoryService(createJobsRepository(env), createConversionsRepository(env))
}
