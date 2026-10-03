import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CreditsContext, type CreditsStatus } from '@/lib/creditsContext'
import { getCredits } from '@/lib/api/credits'
import { isBackendConfigured } from '@/lib/api/client'
import type { CreditTransaction } from '@/lib/api/types'
import { useAuth } from '@/lib/useAuth'

/** Loads the signed-in user's credit balance and history from GET /credits. */
export function CreditsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id ?? null
  const [status, setStatus] = useState<CreditsStatus>('loading')
  const [balance, setBalance] = useState<number | null>(null)
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  // Ignores responses from a request superseded by a newer one (or a sign-out).
  const requestRef = useRef(0)

  const load = useCallback(async (showLoading: boolean) => {
    const request = ++requestRef.current
    if (showLoading) setStatus('loading')
    try {
      const summary = await getCredits()
      if (request !== requestRef.current) return
      setBalance(summary.balance)
      setTransactions(summary.transactions)
      setStatus('ready')
    } catch {
      if (request !== requestRef.current) return
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    requestRef.current++
    setBalance(null)
    setTransactions([])
    if (!isBackendConfigured()) {
      setStatus('unavailable')
      return
    }
    if (authLoading) {
      setStatus('loading')
      return
    }
    if (!userId) {
      setStatus('signed-out')
      return
    }
    void load(true)
  }, [userId, authLoading, load])

  // A background refresh keeps the current numbers on screen while it loads.
  const refresh = useCallback(() => {
    if (userId && isBackendConfigured()) void load(false)
  }, [userId, load])

  const value = useMemo(() => ({ status, balance, transactions, refresh }), [status, balance, transactions, refresh])
  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>
}
