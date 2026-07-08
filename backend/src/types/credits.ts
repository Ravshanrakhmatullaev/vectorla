export interface CreditBalance {
  userId: string
  balance: number
  /** Optimistic-locking token — incremented on every update (see CreditsRepository.setBalance). */
  version: number
  updatedAt: string
}

export type CreditTransactionType = 'debit' | 'credit' | 'refund'

export interface CreditTransaction {
  id: string
  userId: string
  amount: number
  type: CreditTransactionType
  reason: string
  jobId: string | null
  createdAt: string
}
