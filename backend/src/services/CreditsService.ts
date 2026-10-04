import type { CreditBalance, CreditTransaction, UserPlan } from '../types'
import type { Env } from '../env'
import { isLocalDevelopment } from '../env'
import { createCreditsRepository } from '../repositories/createCreditsRepository'
import type { CreditsRepository } from '../repositories/CreditsRepository'
import {
  PLAN_LIMITS,
  CREDIT_COST_BASE_CONVERSION,
  CREDIT_COST_ADDITIONAL_EXPORT_FORMAT,
  CREDIT_COST_PRINT_READY_MODE,
} from '../config'
import { InsufficientCreditsError } from '../errors'

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
  constructor(
    private readonly repository: CreditsRepository,
    // Local development only (see env.ts's isLocalDevelopment) — never true
    // in staging/production. Lets a developer run the full upload -> convert
    // -> download flow without ever calling POST /api/v1/dev/credits/grant
    // by hand; the credit model itself (costs, debits, the check below) is
    // unchanged, this only removes the need to pre-fund a balance locally.
    private readonly autoGrantInDevelopment: boolean = false,
  ) {}

  /** A user with no balance row yet (yet to receive a monthly grant) reads as a zero balance, not an error. */
  async getBalance(userId: string): Promise<CreditBalance> {
    const existing = await this.repository.getBalance(userId)
    return existing ?? { userId, balance: 0, version: 0, updatedAt: new Date().toISOString() }
  }

  /** Returns the caller's newest balance-affecting transactions first. */
  async getRecentTransactions(userId: string, limit: number): Promise<CreditTransaction[]> {
    return this.repository.findTransactionsByUserId(userId, limit)
  }

  /**
   * Cheap pre-check: throws InsufficientCreditsError if the user can't cover
   * requiredCredits right now. Not a reservation — chargeJob is the atomic
   * operation. In local development (autoGrantInDevelopment), a short
   * balance is topped up automatically instead.
   */
  async ensureEnoughCredits(userId: string, requiredCredits: number): Promise<void> {
    const { balance } = await this.getBalance(userId)
    if (balance >= requiredCredits) return
    if (this.autoGrantInDevelopment) {
      await this.credit(userId, requiredCredits - balance, 'Automatic local-development credit top-up')
      return
    }
    throw new InsufficientCreditsError(
      `Not enough credits: you have ${balance}, this conversion needs ${requiredCredits}`,
    )
  }

  /**
   * Charges a job exactly once, atomically (the balance can never go
   * negative, and a redelivered/retried job is never charged twice).
   * Returns false if the job had already been charged.
   */
  async chargeJob(userId: string, jobId: string, amount: number, reason: string): Promise<boolean> {
    try {
      const result = await this.repository.applyEntry({ userId, delta: -amount, type: 'debit', reason, jobId })
      return !result.duplicate
    } catch (error) {
      if (!(error instanceof InsufficientCreditsError) || !this.autoGrantInDevelopment) throw error
      await this.ensureEnoughCredits(userId, amount)
      const result = await this.repository.applyEntry({ userId, delta: -amount, type: 'debit', reason, jobId })
      return !result.duplicate
    }
  }

  async debitCredits(userId: string, amount: number, reason: string, jobId: string | null = null): Promise<CreditTransaction> {
    return (await this.repository.applyEntry({ userId, delta: -amount, type: 'debit', reason, jobId })).transaction
  }

  async credit(userId: string, amount: number, reason: string, grantKey: string | null = null): Promise<CreditTransaction> {
    return (await this.repository.applyEntry({ userId, delta: amount, type: 'credit', reason, jobId: null, grantKey })).transaction
  }

  /**
   * Refunds a job's debit — when a completed job is superseded (see
   * JobService.createJob's `supersedesJobId`) or a job fails terminally.
   * Atomic and idempotent: null if the job was never charged or was
   * already refunded, so concurrent callers can never refund twice.
   */
  async refundJobDebit(userId: string, jobId: string, reason: string): Promise<CreditTransaction | null> {
    return this.repository.refundJob(userId, jobId, reason)
  }

  /**
   * Grants PLAN_LIMITS[plan].monthlyCredits. With a grantKey (e.g.
   * "monthly:2026-09") the grant is applied at most once per key.
   */
  async grantMonthlyCredits(userId: string, plan: UserPlan, grantKey: string | null = null): Promise<CreditTransaction> {
    const amount = PLAN_LIMITS[plan].monthlyCredits
    return this.credit(userId, amount, `Monthly credit grant for plan "${plan}"`, grantKey)
  }
}

export function createCreditsService(env: Env): CreditsService {
  const repository = createCreditsRepository(env)
  return new CreditsService(repository, isLocalDevelopment(env))
}
