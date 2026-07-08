import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreditBalance, CreditTransaction, CreditTransactionType } from '../types'
import type { CreditsRepository } from './CreditsRepository'
import { ConflictError } from '../errors'

// Mirrors backend/supabase/schema.sql's `credit_balances` table exactly.
interface BalanceRow {
  user_id: string
  balance: number
  version: number
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
  return { userId: row.user_id, balance: row.balance, version: row.version, updatedAt: row.updated_at }
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

  /**
   * Optimistic locking via `version` (a plain timestamp isn't safe here —
   * two updates within the same millisecond would collide and the lock
   * would silently fail to notice). `previous === null` means "no row
   * existed when we read it" — the insert itself fails closed (unique
   * violation) if a row was created concurrently in the meantime.
   */
  async setBalance(userId: string, balance: number, previous: CreditBalance | null): Promise<CreditBalance> {
    const now = new Date().toISOString()

    if (!previous) {
      const { data, error } = await this.client
        .from('credit_balances')
        .insert({ user_id: userId, balance, version: 1, updated_at: now })
        .select()
        .maybeSingle<BalanceRow>()

      if (error) {
        if (error.code === '23505') {
          throw new ConflictError(`Credit balance for user "${userId}" was created concurrently`)
        }
        throw new Error(`Failed to create credit balance: ${error.message}`)
      }
      if (!data) throw new Error(`Failed to create credit balance for user "${userId}": no row returned`)
      return mapRowToBalance(data)
    }

    const { data, error } = await this.client
      .from('credit_balances')
      .update({ balance, version: previous.version + 1, updated_at: now })
      .eq('user_id', userId)
      .eq('version', previous.version)
      .select()
      .maybeSingle<BalanceRow>()

    if (error) throw new Error(`Failed to update credit balance: ${error.message}`)
    if (!data) throw new ConflictError(`Credit balance for user "${userId}" was modified concurrently`)
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
