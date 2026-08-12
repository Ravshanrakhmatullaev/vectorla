import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '@/lib/authContext'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
const NOT_CONFIGURED = 'Supabase Auth is not configured.'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let active = true
    void supabase.auth.getSession()
      .then(({ data }) => {
        if (!active) return
        setUser(data.session?.user ?? null)
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      setUser(session?.user ?? null)
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (event === 'SIGNED_OUT') setPasswordRecovery(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseConfigured,
    loading,
    user,
    passwordRecovery,
    async signIn(email, password) {
      if (!supabase) return { error: NOT_CONFIGURED }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error?.message ?? null }
    },
    async signUp(email, password) {
      if (!supabase) return { error: NOT_CONFIGURED }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      return { error: error?.message ?? null, confirmationRequired: !error && !data.session }
    },
    async sendPasswordReset(email) {
      if (!supabase) return { error: NOT_CONFIGURED }
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      return { error: error?.message ?? null }
    },
    async updatePassword(password) {
      if (!supabase) return { error: NOT_CONFIGURED }
      const { error } = await supabase.auth.updateUser({ password })
      return { error: error?.message ?? null }
    },
    async signOut() {
      if (!supabase) return { error: NOT_CONFIGURED }
      const { error } = await supabase.auth.signOut()
      return { error: error?.message ?? null }
    },
    finishPasswordRecovery() {
      setPasswordRecovery(false)
    },
  }), [loading, passwordRecovery, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
