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
  constructor(private readonly repository: CreditsRepository) {}

  /** A user with no balance row yet (yet to receive a monthly grant) reads as a zero balance, not an error. */
  async getBalance(userId: string): Promise<CreditBalance> {
    const existing = await this.repository.getBalance(userId)
    return existing ?? { userId, balance: 0, updatedAt: new Date().toISOString() }
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

  /** Grants PLAN_LIMITS[plan].monthlyCredits — called on billing-cycle renewal (see config/index.ts). */
  async grantMonthlyCredits(userId: string, plan: UserPlan): Promise<CreditTransaction> {
    const amount = PLAN_LIMITS[plan].monthlyCredits
    return this.applyTransaction(userId, amount, amount, 'credit', `Monthly credit grant for plan "${plan}"`, null)
  }

  private async applyTransaction(
    userId: string,
    balanceDelta: number,
    transactionAmount: number,
    type: CreditTransactionType,
    reason: string,
    jobId: string | null,
  ): Promise<CreditTransaction> {
    const current = await this.getBalance(userId)
    await this.repository.setBalance(userId, current.balance + balanceDelta)

    const transaction: CreditTransaction = {
      id: crypto.randomUUID(),
      userId,
      amount: transactionAmount,
      type,
      reason,
      jobId,
      createdAt: new Date().toISOString(),
    }
    return this.repository.createTransaction(transaction)
  }
}

export function createCreditsService(env: Env): CreditsService {
  const repository = createCreditsRepository(env)
  return new CreditsService(repository)
}
