import type { CreditBalance, CreditTransaction, CreditTransactionType } from '../types'

/** One balance change, applied atomically together with its ledger row. */
export interface LedgerEntry {
  userId: string
  /** Signed balance change (negative for debits). */
  delta: number
  type: CreditTransactionType
  reason: string
  jobId: string | null
  /**
   * Idempotency key for grants (e.g. "signup"): a second entry with the same
   * (userId, grantKey) is a no-op. Debits and refunds are idempotent per
   * jobId instead — at most one debit and one refund per job, ever.
   */
  grantKey?: string | null
}

export interface LedgerResult {
  transaction: CreditTransaction
  /** True if an identical entry (same job debit/refund or grant key) already existed; nothing changed. */
  duplicate: boolean
  balance: number
}

export interface CreditsRepository {
  getBalance(userId: string): Promise<CreditBalance | null>
  /**
   * Applies a balance change and its ledger row as ONE atomic operation
   * (Supabase: the apply_credit_entry Postgres function, which locks the
   * balance row). Throws InsufficientCreditsError if the result would be
   * negative — the balance can never go below zero, even under concurrency.
   */
  applyEntry(entry: LedgerEntry): Promise<LedgerResult>
  /** Refunds a job's debit exactly once (atomic). Null if the job was never charged or is already refunded. */
  refundJob(userId: string, jobId: string, reason: string): Promise<CreditTransaction | null>
  findTransactionsByUserId(userId: string, limit?: number): Promise<CreditTransaction[]>
}
