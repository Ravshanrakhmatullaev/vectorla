import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/useAuth'
import { useLanguage } from '@/lib/language'

export type AuthDialogMode = 'sign-in' | 'sign-up' | 'recovery' | 'update-password'
/** Shown above the form after an e-mail link: confirmed, or rejected by Supabase. */
export type AuthNotice = 'email-confirmed' | 'link-invalid'

interface AuthDialogProps {
  open: boolean
  initialMode: AuthDialogMode
  initialEmail?: string
  notice?: AuthNotice | null
  onClose: () => void
}

export function AuthDialog({ open, initialMode, initialEmail = '', notice = null, onClose }: AuthDialogProps) {
  const { t } = useLanguage()
  const auth = useAuth()
  const [mode, setMode] = useState<AuthDialogMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [shownNotice, setShownNotice] = useState<AuthNotice | null>(notice)

  useEffect(() => {
    if (!open) return
    setMode(initialMode)
    if (initialEmail) setEmail(initialEmail)
    setPassword('')
    setError(null)
    setMessage(null)
    setShownNotice(notice)
  }, [initialEmail, initialMode, notice, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  const titles: Record<AuthDialogMode, string> = {
    'sign-in': t.auth.signInTitle,
    'sign-up': t.auth.signUpTitle,
    recovery: t.auth.recoveryTitle,
    'update-password': t.auth.updatePasswordTitle,
  }

  function changeMode(nextMode: AuthDialogMode) {
    setMode(nextMode)
    setPassword('')
    setError(null)
    setMessage(null)
    setShownNotice(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    try {
      if (mode === 'sign-in') {
        const result = await auth.signIn(email, password)
        if (result.code === 'email_not_confirmed') setError(t.auth.emailNotConfirmed)
        else if (result.error) setError(result.error)
        else onClose()
      } else if (mode === 'sign-up') {
        const result = await auth.signUp(email, password)
        if (result.error) setError(result.error)
        else if (result.confirmationRequired) {
          // The link may be opened on another device, which does not sign
          // this browser in: leave the sign-in form ready for when they return.
          setMode('sign-in')
          setPassword('')
          setMessage(t.auth.confirmationSent)
        } else onClose()
      } else if (mode === 'recovery') {
        const result = await auth.sendPasswordReset(email)
        if (result.error) setError(result.error)
        else setMessage(t.auth.recoverySent)
      } else {
        const result = await auth.updatePassword(password)
        if (result.error) setError(result.error)
        else {
          auth.finishPasswordRecovery()
          setMessage(t.auth.passwordUpdated)
        }
      }
    } catch (unexpectedError) {
      setError(unexpectedError instanceof Error ? unexpectedError.message : t.auth.requestFailed)
    } finally {
      setSubmitting(false)
    }
  }

  const needsEmail = mode !== 'update-password'
  const needsPassword = mode !== 'recovery'
  const submitLabel = mode === 'sign-in'
    ? t.auth.signIn
    : mode === 'sign-up'
      ? t.auth.signUp
      : mode === 'recovery'
        ? t.auth.sendReset
        : t.auth.updatePassword

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="auth-dialog-title" className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--ink)]">
            {titles[mode]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.auth.close}
            className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--ink)]"
          >
            <X size={18} />
          </button>
        </div>

        {shownNotice && (
          <p
            role="status"
            className={
              shownNotice === 'email-confirmed'
                ? 'mt-4 rounded-xl border border-emerald-600/30 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'mt-4 rounded-xl border border-amber-600/30 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
            }
          >
            {shownNotice === 'email-confirmed' ? t.auth.emailConfirmed : t.auth.linkInvalid}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {needsEmail && (
            <label className="block text-sm font-medium text-[var(--ink)]">
              {t.auth.email}
              <input
                type="email"
                autoComplete="email"
                required
                autoFocus={!initialEmail}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg)] px-3.5 py-2.5 text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--ring)]"
              />
            </label>
          )}

          {needsPassword && (
            <label className="block text-sm font-medium text-[var(--ink)]">
              {mode === 'update-password' ? t.auth.newPassword : t.auth.password}
              <input
                type="password"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                autoFocus={!needsEmail || Boolean(initialEmail)}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg)] px-3.5 py-2.5 text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--ring)]"
              />
            </label>
          )}

          {!auth.configured && <p className="text-sm text-amber-700 dark:text-amber-300">{t.auth.notConfigured}</p>}
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}

          <Button type="submit" className="w-full" disabled={!auth.configured || submitting}>
            {submitting ? t.common.loading : submitLabel}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
          {mode === 'sign-in' && (
            <>
              <button type="button" onClick={() => changeMode('recovery')} className="text-[var(--accent)] hover:underline">
                {t.auth.forgotPassword}
              </button>
              <button type="button" onClick={() => changeMode('sign-up')} className="text-[var(--accent)] hover:underline">
                {t.auth.createAccount}
              </button>
            </>
          )}
          {mode === 'sign-up' && (
            <button type="button" onClick={() => changeMode('sign-in')} className="text-[var(--accent)] hover:underline">
              {t.auth.haveAccount}
            </button>
          )}
          {mode === 'recovery' && (
            <button type="button" onClick={() => changeMode('sign-in')} className="text-[var(--accent)] hover:underline">
              {t.auth.backToSignIn}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
