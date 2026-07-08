import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreditBalance, CreditTransaction, CreditTransactionType } from '../types'
import type { CreditsRepository } from './CreditsRepository'

// Mirrors backend/supabase/schema.sql's `credit_balances` table exactly.
interface BalanceRow {
  user_id: string
  balance: number
  updated_at: string
}

// Mirrors backend/supabase/schema.sql's `credit_transactions` table exactly.
interface TransactionRow {
  id: string
  user_id: string
  amount: number
  type: string
  reason: string
  job_id: string | null
  created_at: string
}

function mapRowToBalance(row: BalanceRow): CreditBalance {
  return { userId: row.user_id, balance: row.balance, updatedAt: row.updated_at }
}

function mapRowToTransaction(row: TransactionRow): CreditTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    type: row.type as CreditTransactionType,
    reason: row.reason,
    jobId: row.job_id,
    createdAt: row.created_at,
  }
}

/** Real Supabase-backed implementation — used whenever SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are configured (see createCreditsRepository). */
export class SupabaseCreditsRepository implements CreditsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getBalance(userId: string): Promise<CreditBalance | null> {
    const { data, error } = await this.client
      .from('credit_balances')
      .select()
      .eq('user_id', userId)
      .maybeSingle<BalanceRow>()

    if (error) throw new Error(`Failed to fetch credit balance: ${error.message}`)
    return data ? mapRowToBalance(data) : null
  }

  async setBalance(userId: string, balance: number): Promise<CreditBalance> {
    const { data, error } = await this.client
      .from('credit_balances')
      .upsert({ user_id: userId, balance, updated_at: new Date().toISOString() })
      .select()
      .single<BalanceRow>()

    if (error) throw new Error(`Failed to update credit balance: ${error.message}`)
    return mapRowToBalance(data)
  }

  async createTransaction(transaction: CreditTransaction): Promise<CreditTransaction> {
    const { data, error } = await this.client
      .from('credit_transactions')
      .insert({
        id: transaction.id,
        user_id: transaction.userId,
        amount: transaction.amount,
        type: transaction.type,
        reason: transaction.reason,
        job_id: transaction.jobId,
      })
      .select()
      .single<TransactionRow>()

    if (error) throw new Error(`Failed to save credit transaction: ${error.message}`)
    return mapRowToTransaction(data)
  }

  async findTransactionsByUserId(userId: string): Promise<CreditTransaction[]> {
    const { data, error } = await this.client
      .from('credit_transactions')
      .select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .returns<TransactionRow[]>()

    if (error) throw new Error(`Failed to list credit transactions: ${error.message}`)
    return (data ?? []).map(mapRowToTransaction)
  }
}
