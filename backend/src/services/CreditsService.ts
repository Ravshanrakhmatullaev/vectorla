import type { CreditBalance, CreditTransaction, CreditTransactionType, UserPlan } from '../types'
import type { Env } from '../env'
import { createCreditsRepository } from '../repositories/createCreditsRepository'
import type { CreditsRepository } from '../repositories/CreditsRepository'
import {
  PLAN_LIMITS,
  CREDIT_COST_BASE_CONVERSION,
  CREDIT_COST_ADDITIONAL_EXPORT_FORMAT,
  CREDIT_COST_PRINT_READY_MODE,
} from '../config'
import { InsufficientCreditsError, ConflictError } from '../errors'

/** Bounded optimistic-lock retries for applyTransaction — see setBalance's ConflictError. */
const MAX_BALANCE_UPDATE_ATTEMPTS = 5

/**
 * Computes the credit cost of a conversion: a base cost, plus
 * CREDIT_COST_ADDITIONAL_EXPORT_FORMAT for each export format beyond the
 * first, plus CREDIT_COST_PRINT_READY_MODE if print-ready mode is requested.
 *
 * TODO(backend): today's pipeline (ConversionService.processJob) always
 * requests exactly one format and never print-ready mode — Job doesn't carry
 * either yet — so this is only ever called with (1, false) for now. The
 * per-plan "print-ready included" waiver (see PLAN_LIMITS.printReadyIncluded
 * in backend/README.md's pricing table) also isn't applied here, since
 * nothing in this flow currently knows the caller's plan.
 */
export function calculateRequiredCredits(formatCount: number, printReady: boolean): number {
  const additionalFormats = Math.max(0, formatCount - 1)
  return (
    CREDIT_COST_BASE_CONVERSION +
    additionalFormats * CREDIT_COST_ADDITIONAL_EXPORT_FORMAT +
    (printReady ? CREDIT_COST_PRINT_READY_MODE : 0)
  )
}

export class CreditsService {
  constructor(private readonly repository: CreditsRepository) {}

  /** A user with no balance row yet (yet to receive a monthly grant) reads as a zero balance, not an error. */
  async getBalance(userId: string): Promise<CreditBalance> {
    const existing = await this.repository.getBalance(userId)
    return existing ?? { userId, balance: 0, version: 0, updatedAt: new Date().toISOString() }
  }

  /** Throws InsufficientCreditsError if the user can't cover requiredCredits — callers (e.g. ConversionService) let this fail the job. */
  async ensureEnoughCredits(userId: string, requiredCredits: number): Promise<void> {
    const { balance } = await this.getBalance(userId)
    if (balance < requiredCredits) {
      throw new InsufficientCreditsError(
        `User "${userId}" has ${balance} credit${balance === 1 ? '' : 's'}, needs ${requiredCredits}`,
      )
    }
  }

  async debitCredits(userId: string, amount: number, reason: string, jobId: string | null = null): Promise<CreditTransaction> {
    return this.applyTransaction(userId, -amount, amount, 'debit', reason, jobId)
  }

  async credit(userId: string, amount: number, reason: string): Promise<CreditTransaction> {
    return this.applyTransaction(userId, amount, amount, 'credit', reason, null)
  }

  /**
   * Phase 26: refunds a specific job's debit — used when a caller supersedes
   * an already-completed (and already-billed) job with a new one for the
   * same upload (see JobService.createJob's `supersedesJobId`), so switching
   * Quick Trace <-> Professional Trace after a result already exists never
   * stacks charges on top of each other. Idempotent: a no-op (returns null)
   * if the job was never actually debited, or was already refunded —
   * safe to call more than once for the same jobId.
   */
  async refundJobDebit(userId: string, jobId: string, reason: string): Promise<CreditTransaction | null> {
    const transactions = await this.repository.findTransactionsByUserId(userId)
    const debit = transactions.find((t) => t.jobId === jobId && t.type === 'debit')
    if (!debit) return null
    const alreadyRefunded = transactions.some((t) => t.jobId === jobId && t.type === 'refund')
    if (alreadyRefunded) return null
    return this.applyTransaction(userId, debit.amount, debit.amount, 'refund', reason, jobId)
  }

  /** Grants PLAN_LIMITS[plan].monthlyCredits — called on billing-cycle renewal (see config/index.ts). */
  async grantMonthlyCredits(userId: string, plan: UserPlan): Promise<CreditTransaction> {
    const amount = PLAN_LIMITS[plan].monthlyCredits
    return this.applyTransaction(userId, amount, amount, 'credit', `Monthly credit grant for plan "${plan}"`, null)
  }

  /**
   * Read-modify-write on the balance, guarded by optimistic locking
   * (CreditsRepository.setBalance) so two concurrent debits/credits for the
   * same user can't both read the same starting balance and silently lose
   * one update. Retries a bounded number of times on conflict before giving
   * up — real contention on one user's balance is expected to be rare (at
   * most one in-flight conversion per job today).
   */
  private async applyTransaction(
    userId: string,
    balanceDelta: number,
    transactionAmount: number,
    type: CreditTransactionType,
    reason: string,
    jobId: string | null,
  ): Promise<CreditTransaction> {
    let lastConflict: ConflictError | undefined
    for (let attempt = 0; attempt < MAX_BALANCE_UPDATE_ATTEMPTS; attempt++) {
      const previous = await this.repository.getBalance(userId)
      const currentBalance = previous?.balance ?? 0
      try {
        await this.repository.setBalance(userId, currentBalance + balanceDelta, previous)
        const transaction: CreditTransaction = {
          id: crypto.randomUUID(),
          userId,
          amount: transactionAmount,
          type,
          reason,
          jobId,
          createdAt: new Date().toISOString(),
        }
        return await this.repository.createTransaction(transaction)
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error
        lastConflict = error
      }
    }
    throw lastConflict
  }
}

export function createCreditsService(env: Env): CreditsService {
  const repository = createCreditsRepository(env)
  return new CreditsService(repository)
}
