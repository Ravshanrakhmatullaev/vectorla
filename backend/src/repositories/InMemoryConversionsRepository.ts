import type { Conversion } from '../types'
import type { ConversionsRepository } from './ConversionsRepository'

/**
 * In-memory fallback used automatically when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
 * aren't configured (see createConversionsRepository) — same caveat as
 * InMemoryUploadsRepository/InMemoryJobsRepository: not suitable for production.
 */
export class InMemoryConversionsRepository implements ConversionsRepository {
  private readonly conversionsById = new Map<string, Conversion>()

  async create(conversion: Conversion): Promise<Conversion> {
    this.conversionsById.set(conversion.id, conversion)
    return conversion
  }

  async findById(id: string): Promise<Conversion | null> {
    return this.conversionsById.get(id) ?? null
  }

  async findByJobId(jobId: string): Promise<Conversion | null> {
    for (const conversion of this.conversionsById.values()) {
      if (conversion.jobId === jobId) return conversion
    }
    return null
  }

  async findByUserId(userId: string): Promise<Conversion[]> {
    return Array.from(this.conversionsById.values())
      .filter((conversion) => conversion.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async findByStorageKey(storageKey: string): Promise<Conversion | null> {
    for (const conversion of this.conversionsById.values()) {
      if (conversion.storageKey === storageKey) return conversion
    }
    return null
  }
}
