import type { CreditBalance, CreditTransaction } from '../types'
import type { CreditsRepository, LedgerEntry, LedgerResult } from './CreditsRepository'
import { InsufficientCreditsError } from '../errors'

/**
 * In-memory fallback used automatically when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
 * aren't configured (see createCreditsRepository) — not suitable for
 * production. Mirrors the Postgres ledger functions exactly: each operation
 * runs synchronously between awaits, so it is atomic in a single isolate.
 */
export class InMemoryCreditsRepository implements CreditsRepository {
  private readonly balancesByUserId = new Map<string, CreditBalance>()
  private readonly transactions: (CreditTransaction & { grantKey: string | null })[] = []

  async getBalance(userId: string): Promise<CreditBalance | null> {
    return this.balancesByUserId.get(userId) ?? null
  }

  async applyEntry(entry: LedgerEntry): Promise<LedgerResult> {
    return this.applySync(entry)
  }

  async refundJob(userId: string, jobId: string, reason: string): Promise<CreditTransaction | null> {
    const debit = this.transactions.find((t) => t.jobId === jobId && t.type === 'debit' && t.userId === userId)
    if (!debit) return null
    const result = this.applySync({ userId, delta: debit.amount, type: 'refund', reason, jobId })
    return result.duplicate ? null : result.transaction
  }

  async findTransactionsByUserId(userId: string, limit?: number): Promise<CreditTransaction[]> {
    return this.transactions
      .filter((transaction) => transaction.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(({ grantKey: _grantKey, ...transaction }) => transaction)
  }

  private applySync(entry: LedgerEntry): LedgerResult {
    const current = this.balancesByUserId.get(entry.userId)
    const balance = current?.balance ?? 0
    const existing = this.transactions.find((t) =>
      entry.grantKey
        ? t.userId === entry.userId && t.grantKey === entry.grantKey
        : entry.jobId !== null && (entry.type === 'debit' || entry.type === 'refund') && t.jobId === entry.jobId && t.type === entry.type,
    )
    if (existing) {
      const { grantKey: _grantKey, ...transaction } = existing
      return { transaction, duplicate: true, balance }
    }
    if (balance + entry.delta < 0) {
      throw new InsufficientCreditsError(`Not enough credits: you have ${balance}, this needs ${-entry.delta}`)
    }
    const now = new Date().toISOString()
    this.balancesByUserId.set(entry.userId, {
      userId: entry.userId,
      balance: balance + entry.delta,
      version: (current?.version ?? 0) + 1,
      updatedAt: now,
    })
    const transaction: CreditTransaction = {
      id: crypto.randomUUID(),
      userId: entry.userId,
      amount: Math.abs(entry.delta),
      type: entry.type,
      reason: entry.reason,
      jobId: entry.jobId,
      createdAt: now,
    }
    this.transactions.push({ ...transaction, grantKey: entry.grantKey ?? null })
    return { transaction, duplicate: false, balance: balance + entry.delta }
  }
}
