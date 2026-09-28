import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreditBalance, CreditTransaction, CreditTransactionType } from '../types'
import type { CreditsRepository, LedgerEntry, LedgerResult } from './CreditsRepository'
import { InsufficientCreditsError } from '../errors'

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

// Row returned by apply_credit_entry / refund_job_credits.
interface LedgerRow extends TransactionRow {
  duplicate: boolean
  balance: number
}

function mapLedgerRow(row: LedgerRow): LedgerResult {
  const { duplicate, balance, ...transaction } = row
  return { transaction: mapRowToTransaction(transaction), duplicate, balance }
}

function mapLedgerError(error: { message: string }, userId: string): Error {
  if (error.message.includes('insufficient_credits')) {
    return new InsufficientCreditsError(`User "${userId}" does not have enough credits`)
  }
  return new Error(`Credit ledger operation failed: ${error.message}`)
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

  /** Calls the apply_credit_entry Postgres function (supabase/migrations/0002_credit_integrity.sql). */
  async applyEntry(entry: LedgerEntry): Promise<LedgerResult> {
    const { data, error } = await this.client
      .rpc('apply_credit_entry', {
        p_user_id: entry.userId,
        p_delta: entry.delta,
        p_type: entry.type,
        p_reason: entry.reason,
        p_job_id: entry.jobId,
        p_grant_key: entry.grantKey ?? null,
      })
      .single<LedgerRow>()
    if (error) throw mapLedgerError(error, entry.userId)
    return mapLedgerRow(data)
  }

  /** Calls the refund_job_credits Postgres function — refunds a job's debit exactly once. */
  async refundJob(userId: string, jobId: string, reason: string): Promise<CreditTransaction | null> {
    const { data, error } = await this.client
      .rpc('refund_job_credits', { p_user_id: userId, p_job_id: jobId, p_reason: reason })
      .maybeSingle<LedgerRow>()
    if (error) throw mapLedgerError(error, userId)
    if (!data || data.duplicate) return null
    return mapLedgerRow(data).transaction
  }

  async findTransactionsByUserId(userId: string, limit?: number): Promise<CreditTransaction[]> {
    let query = this.client
      .from('credit_transactions')
      .select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (limit !== undefined) query = query.limit(limit)
    const { data, error } = await query.returns<TransactionRow[]>()

    if (error) throw new Error(`Failed to list credit transactions: ${error.message}`)
    return (data ?? []).map(mapRowToTransaction)
  }
}
