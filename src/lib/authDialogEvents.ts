import type { AuthDialogMode } from '@/components/AuthDialog'

// The sign-in dialog lives in the Navbar; other pages (e.g. /account) ask it
// to open through this window event instead of owning a second dialog.
const OPEN_AUTH_DIALOG_EVENT = 'vectorla:open-auth-dialog'

export function requestAuthDialog(mode: AuthDialogMode = 'sign-in'): void {
  window.dispatchEvent(new CustomEvent<AuthDialogMode>(OPEN_AUTH_DIALOG_EVENT, { detail: mode }))
}

export function onAuthDialogRequest(listener: (mode: AuthDialogMode) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AuthDialogMode>).detail)
  window.addEventListener(OPEN_AUTH_DIALOG_EVENT, handler)
  return () => window.removeEventListener(OPEN_AUTH_DIALOG_EVENT, handler)
}
