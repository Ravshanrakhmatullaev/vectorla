import type { CreditBalance, CreditTransaction } from '../types'
import type { CreditsRepository } from './CreditsRepository'
import { ConflictError } from '../errors'

/**
 * In-memory fallback used automatically when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
 * aren't configured (see createCreditsRepository) — same caveat as
 * InMemoryUploadsRepository/InMemoryJobsRepository: not suitable for production.
 */
export class InMemoryCreditsRepository implements CreditsRepository {
  private readonly balancesByUserId = new Map<string, CreditBalance>()
  private readonly transactions: CreditTransaction[] = []

  async getBalance(userId: string): Promise<CreditBalance | null> {
    return this.balancesByUserId.get(userId) ?? null
  }

  async setBalance(userId: string, balance: number, previous: CreditBalance | null): Promise<CreditBalance> {
    const current = this.balancesByUserId.get(userId) ?? null
    if ((current?.version ?? 0) !== (previous?.version ?? 0)) {
      throw new ConflictError(`Credit balance for user "${userId}" was modified concurrently`)
    }
    const record: CreditBalance = {
      userId,
      balance,
      version: (previous?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    }
    this.balancesByUserId.set(userId, record)
    return record
  }

  async createTransaction(transaction: CreditTransaction): Promise<CreditTransaction> {
    this.transactions.push(transaction)
    return transaction
  }

  async findTransactionsByUserId(userId: string): Promise<CreditTransaction[]> {
    return this.transactions
      .filter((transaction) => transaction.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
}
