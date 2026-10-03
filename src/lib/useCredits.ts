import { useContext } from 'react'
import { CreditsContext, type CreditsContextValue } from '@/lib/creditsContext'

export function useCredits(): CreditsContextValue {
  const context = useContext(CreditsContext)
  if (!context) throw new Error('useCredits must be used within a CreditsProvider')
  return context
}
