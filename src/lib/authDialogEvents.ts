import type { AuthDialogMode, AuthNotice } from '@/components/AuthDialog'

// The sign-in dialog lives in the Navbar; other pages (e.g. /account) ask it
// to open through this window event instead of owning a second dialog.
const OPEN_AUTH_DIALOG_EVENT = 'vectorla:open-auth-dialog'

export interface AuthDialogRequest {
  mode: AuthDialogMode
  /** A message shown above the form, e.g. after an e-mail confirmation link. */
  notice?: AuthNotice
  /** Prefills the e-mail field. */
  email?: string
}

export function requestAuthDialog(mode: AuthDialogMode = 'sign-in', options: Omit<AuthDialogRequest, 'mode'> = {}): void {
  window.dispatchEvent(new CustomEvent<AuthDialogRequest>(OPEN_AUTH_DIALOG_EVENT, { detail: { mode, ...options } }))
}

export function onAuthDialogRequest(listener: (request: AuthDialogRequest) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AuthDialogRequest>).detail)
  window.addEventListener(OPEN_AUTH_DIALOG_EVENT, handler)
  return () => window.removeEventListener(OPEN_AUTH_DIALOG_EVENT, handler)
}
