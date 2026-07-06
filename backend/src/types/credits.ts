export interface CreditBalance {
  userId: string
  balance: number
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
