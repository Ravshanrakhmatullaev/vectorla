import { createClient } from '@supabase/supabase-js'
import { EMAIL_CONFIRMED_PATH, readEmailLinkResult, type EmailLinkResult } from '@/lib/emailLink'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

// A signup confirmation link is read here, before the client starts, so it
// never becomes a session in this browser: the link may be opened on a
// phone while the account was created on a computer, so the user signs in
// wherever they want instead ("Email confirmed — you can sign in"). The
// tokens are removed from the address bar, and the session Supabase created
// for the link is revoked.
let pendingEmailLinkResult: EmailLinkResult | null = null
if (isSupabaseConfigured) {
  const url = new URL(window.location.href)
  pendingEmailLinkResult = readEmailLinkResult(url)
  if (pendingEmailLinkResult || url.pathname === EMAIL_CONFIRMED_PATH) {
    const path = url.pathname === EMAIL_CONFIRMED_PATH ? '/' : url.pathname
    window.history.replaceState(window.history.state, '', path + url.search)
  }
  if (pendingEmailLinkResult?.kind === 'signup-confirmed') {
    void fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: supabasePublishableKey, Authorization: `Bearer ${pendingEmailLinkResult.accessToken}` },
    }).catch(() => undefined)
  }
}

/** The e-mail link result this page was opened with, returned once. */
export function consumeEmailLinkResult(): EmailLinkResult | null {
  const result = pendingEmailLinkResult
  pendingEmailLinkResult = null
  return result
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Password-recovery links still sign in here (the user sets a new
        // password); signup confirmations were handled above.
        detectSessionInUrl: true,
      },
    })
  : null

/** Reads the latest auto-refreshed session for the shared API client. */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.access_token ?? null
}
