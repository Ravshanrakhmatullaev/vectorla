import type { Env } from '../env'
import type { CreditTransaction } from '../types'
import { createCreditsService } from '../services/CreditsService'
import { requireAuth } from '../middleware/requireAuth'
import { jsonError, jsonSuccess, mapErrorToResponse, withNoStore } from '../api/response'

const DEFAULT_TRANSACTION_LIMIT = 20
const MAX_TRANSACTION_LIMIT = 100

type PublicCreditTransaction = Omit<CreditTransaction, 'userId'>

function parseTransactionLimit(url: URL): number {
  const value = Number(url.searchParams.get('limit'))
  if (!Number.isInteger(value) || value <= 0) return DEFAULT_TRANSACTION_LIMIT
  return Math.min(value, MAX_TRANSACTION_LIMIT)
}

function toPublicTransaction(transaction: CreditTransaction): PublicCreditTransaction {
  const { userId: _userId, ...publicTransaction } = transaction
  return publicTransaction
}

/** GET /api/v1/credits -- current balance plus the caller's recent transactions. */
export async function handleCreditsRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonError('VALIDATION_ERROR', 'Method not allowed', 405, requestId)
  }

  try {
    const { userId } = await requireAuth(request, env)
    const creditsService = createCreditsService(env)
    const [balance, transactions] = await Promise.all([
      creditsService.getBalance(userId),
      creditsService.getRecentTransactions(userId, parseTransactionLimit(new URL(request.url))),
    ])
    return withNoStore(jsonSuccess({
      balance: balance.balance,
      transactions: transactions.map(toPublicTransaction),
    }, 200, requestId))
  } catch (error) {
    return withNoStore(mapErrorToResponse(error, requestId))
  }
}
