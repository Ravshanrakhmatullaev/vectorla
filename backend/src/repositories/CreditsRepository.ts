import type { CreditBalance, CreditTransaction } from '../types'

export interface CreditsRepository {
  getBalance(userId: string): Promise<CreditBalance | null>
  setBalance(userId: string, balance: number): Promise<CreditBalance>
  createTransaction(transaction: CreditTransaction): Promise<CreditTransaction>
  findTransactionsByUserId(userId: string): Promise<CreditTransaction[]>
}
