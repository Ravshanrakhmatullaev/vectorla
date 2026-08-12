import { createContext } from 'react'
import type { User } from '@supabase/supabase-js'

export interface AuthActionResult {
  error: string | null
  confirmationRequired?: boolean
}

export interface AuthContextValue {
  configured: boolean
  loading: boolean
  user: User | null
  passwordRecovery: boolean
  signIn: (email: string, password: string) => Promise<AuthActionResult>
  signUp: (email: string, password: string) => Promise<AuthActionResult>
  sendPasswordReset: (email: string) => Promise<AuthActionResult>
  updatePassword: (password: string) => Promise<AuthActionResult>
  signOut: () => Promise<AuthActionResult>
  finishPasswordRecovery: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
