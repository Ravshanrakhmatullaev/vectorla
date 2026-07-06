import type { CreditBalance, CreditTransaction } from '../types'

// TODO(backend): wire to Supabase credit_balances / credit_transactions tables (see schema.sql).
export class CreditsService {
  async getBalance(_userId: string): Promise<CreditBalance> {
    throw new Error('Not implemented')
  }

  async debit(_userId: string, _amount: number, _reason: string, _jobId?: string): Promise<CreditTransaction> {
    throw new Error('Not implemented')
  }

  async credit(_userId: string, _amount: number, _reason: string): Promise<CreditTransaction> {
    throw new Error('Not implemented')
  }
}
