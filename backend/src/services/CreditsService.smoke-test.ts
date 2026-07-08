// Local smoke test for CreditsService and calculateRequiredCredits — exercises
// balance reads, the enough/not-enough credits check, debiting, crediting,
// and the monthly grant, against an in-memory repository.
//
// Run with: npx tsx src/services/CreditsService.smoke-test.ts (from inside backend/)
import { CreditsService, calculateRequiredCredits } from './CreditsService'
import { InMemoryCreditsRepository } from '../repositories/InMemoryCreditsRepository'
import { CREDIT_COST_BASE_CONVERSION, CREDIT_COST_ADDITIONAL_EXPORT_FORMAT, CREDIT_COST_PRINT_READY_MODE } from '../config'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function assertRejects(fn: () => Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!pattern.test(msg)) throw new Error(`${message}: error "${msg}" did not match ${pattern}`)
    return
  }
  throw new Error(`${message}: expected the call to reject, but it resolved`)
}

async function run() {
  // 1. calculateRequiredCredits — pure function over the pricing config
  assertEqual(calculateRequiredCredits(1, false), CREDIT_COST_BASE_CONVERSION, 'base cost for 1 format, no print-ready')
  assertEqual(
    calculateRequiredCredits(3, false),
    CREDIT_COST_BASE_CONVERSION + 2 * CREDIT_COST_ADDITIONAL_EXPORT_FORMAT,
    'base + 2 additional formats',
  )
  assertEqual(
    calculateRequiredCredits(1, true),
    CREDIT_COST_BASE_CONVERSION + CREDIT_COST_PRINT_READY_MODE,
    'base + print-ready surcharge',
  )
  console.log('PASS: calculateRequiredCredits combines base/additional-format/print-ready costs correctly')

  const repository = new InMemoryCreditsRepository()
  const service = new CreditsService(repository)

  // 2. getBalance for a user with no balance row yet reads as zero, not an error
  const freshBalance = await service.getBalance('user-1')
  assertEqual(freshBalance.balance, 0, 'a user with no grant yet has a zero balance')
  console.log('PASS: getBalance returns a zero balance for a user with no credit history')

  // 3. ensureEnoughCredits — not enough
  await assertRejects(
    () => service.ensureEnoughCredits('user-1', 1),
    /has 0 credits, needs 1/,
    'insufficient credits',
  )
  console.log('PASS: ensureEnoughCredits rejects when the balance is too low')

  // 4. grantMonthlyCredits — credits the plan's monthly amount and records a transaction
  const grant = await service.grantMonthlyCredits('user-1', 'starter')
  assertEqual(grant.type, 'credit', 'grant transaction type')
  assertEqual(grant.amount, 100, 'starter plan grants 100 credits/mo')
  const balanceAfterGrant = await service.getBalance('user-1')
  assertEqual(balanceAfterGrant.balance, 100, 'balance reflects the grant')
  console.log('PASS: grantMonthlyCredits credits PLAN_LIMITS[plan].monthlyCredits and records a transaction')

  // 5. ensureEnoughCredits — now enough
  await service.ensureEnoughCredits('user-1', 100)
  console.log('PASS: ensureEnoughCredits resolves once the balance covers the requirement')

  // 6. debitCredits — reduces the balance and records a debit transaction
  const debit = await service.debitCredits('user-1', 30, 'Conversion for job "job-1"', 'job-1')
  assertEqual(debit.type, 'debit', 'debit transaction type')
  assertEqual(debit.amount, 30, 'debit transaction amount')
  assertEqual(debit.jobId, 'job-1', 'debit transaction references the job')
  const balanceAfterDebit = await service.getBalance('user-1')
  assertEqual(balanceAfterDebit.balance, 70, 'balance reduced by the debited amount')
  console.log('PASS: debitCredits reduces the balance and records a debit transaction')

  // 7. credit — increases the balance and records a credit transaction
  const refundLikeCredit = await service.credit('user-1', 5, 'Manual adjustment')
  assertEqual(refundLikeCredit.type, 'credit', 'credit transaction type')
  const balanceAfterCredit = await service.getBalance('user-1')
  assertEqual(balanceAfterCredit.balance, 75, 'balance increased by the credited amount')
  console.log('PASS: credit increases the balance and records a credit transaction')

  // 8. All transactions are retrievable per user, most recent first
  const history = await repository.findTransactionsByUserId('user-1')
  assertEqual(history.length, 3, 'grant + debit + credit all recorded')
  console.log('PASS: transaction history accumulates all balance-affecting operations')

  console.log('\nAll CreditsService smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
