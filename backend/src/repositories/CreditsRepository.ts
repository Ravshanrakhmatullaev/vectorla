import type { CreditBalance, CreditTransaction } from '../types'

export interface CreditsRepository {
  getBalance(userId: string): Promise<CreditBalance | null>
  /**
   * Optimistic locking via `previous` — the balance row exactly as last read
   * by the caller (or `null` if none exists yet). Implementations throw
   * ConflictError if the stored state has since changed, so two concurrent
   * debits/credits for the same user can't silently lose an update.
   */
  setBalance(userId: string, balance: number, previous: CreditBalance | null): Promise<CreditBalance>
  createTransaction(transaction: CreditTransaction): Promise<CreditTransaction>
  findTransactionsByUserId(userId: string, limit?: number): Promise<CreditTransaction[]>
}
