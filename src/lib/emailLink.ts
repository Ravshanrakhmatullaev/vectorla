// Supabase e-mail links (signup confirmation, password reset) open
// Supabase's /verify endpoint, which redirects back to the `redirect_to` we
// sent: the confirmation's result arrives in the URL fragment. Supabase only
// honors `redirect_to` values on the project's redirect allowlist and falls
// back to its Site URL otherwise (DEPLOYMENT.md, "Supabase Auth settings").

/** Where the signup confirmation link returns to. */
export const EMAIL_CONFIRMED_PATH = '/auth/confirmed'

/**
 * The origin e-mail links return to: VITE_AUTH_REDIRECT_ORIGIN when the build
 * sets one (e.g. https://vectorla.app for production, so www visitors land on
 * the apex), otherwise the origin the visitor is on.
 */
export function authRedirectUrl(path: string): string {
  const configured = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN?.trim()
  return `${configured || window.location.origin}${path}`
}

export type EmailLinkResult =
  /** The address was confirmed. `email` is shown in the sign-in form. */
  | { kind: 'signup-confirmed'; email: string | null; accessToken: string }
  /** Supabase rejected the link: already used, expired or malformed. */
  | { kind: 'link-invalid' }

/**
 * Reads a signup-confirmation result or an e-mail link error from the URL.
 * Anything else (a password-recovery link, a normal page) returns null and
 * is left to supabase-js.
 */
export function readEmailLinkResult(url: URL): EmailLinkResult | null {
  const params = new URLSearchParams(url.hash.replace(/^#/, ''))
  if (params.get('error') || params.get('error_code')) return { kind: 'link-invalid' }

  const accessToken = params.get('access_token')
  if (!accessToken) return null
  const type = params.get('type')
  if (type === 'signup' || (url.pathname === EMAIL_CONFIRMED_PATH && type !== 'recovery')) {
    return { kind: 'signup-confirmed', email: emailFromJwt(accessToken), accessToken }
  }
  return null
}

/** The `email` claim of a JWT, for display only (not verified). */
function emailFromJwt(token: string): string | null {
  try {
    const payload = token.split('.')[1] ?? ''
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))
    const email = (JSON.parse(json) as { email?: unknown }).email
    return typeof email === 'string' && email.includes('@') ? email : null
  } catch {
    return null
  }
}
