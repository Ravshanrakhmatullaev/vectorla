import { createContext } from 'react'
import type { CreditTransaction } from '@/lib/api/types'

export type CreditsStatus = 'unavailable' | 'signed-out' | 'loading' | 'ready' | 'error'

export interface CreditsContextValue {
  status: CreditsStatus
  balance: number | null
  transactions: CreditTransaction[]
  /** Re-fetches the balance and history, e.g. after a trace finishes. */
  refresh: () => void
}

export const CreditsContext = createContext<CreditsContextValue | undefined>(undefined)
