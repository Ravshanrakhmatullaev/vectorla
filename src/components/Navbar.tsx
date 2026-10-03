import { useEffect, useState } from 'react'
import { Coins, Menu, X } from 'lucide-react'
import { AuthDialog, type AuthDialogMode } from '@/components/AuthDialog'
import { LogoMark } from '@/components/LogoMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Button } from '@/components/ui/Button'
import { Link } from '@/components/ui/Link'
import { navLinks } from '@/data/nav'
import { useAuth } from '@/lib/useAuth'
import { useLanguage } from '@/lib/language'
import { useCredits } from '@/lib/useCredits'
import { onAuthDialogRequest } from '@/lib/authDialogEvents'
import { formatCredits } from '@/utils/formatCredits'
import type { CreditsContextValue } from '@/lib/creditsContext'
import type { Language, Translation } from '@/data/i18n'

/** The balance once loaded; just the word "Credits" while loading or on error. */
function creditsLabel(credits: CreditsContextValue, language: Language, t: Translation): string {
  return credits.status === 'ready' && credits.balance !== null
    ? formatCredits(credits.balance, language, t.credits.unit)
    : t.nav.account
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthDialogMode>('sign-in')
  const { t, language } = useLanguage()
  const { user, loading, passwordRecovery, signOut } = useAuth()
  const credits = useCredits()

  useEffect(() => {
    if (!passwordRecovery) return
    setAuthMode('update-password')
    setAuthOpen(true)
  }, [passwordRecovery])

  function openAuth(mode: AuthDialogMode) {
    setAuthMode(mode)
    setAuthOpen(true)
    setMobileOpen(false)
  }

  useEffect(() => onAuthDialogRequest(openAuth), [])

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={30} />
            <span className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--ink)]">
              Vectorla
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
              >
                {t.nav[link.id]}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <LanguageSwitcher />
            <ThemeToggle />
            {user ? (
              <>
                <span className="hidden max-w-40 truncate text-sm text-[var(--ink-muted)] xl:inline" title={user.email}>
                  {user.email}
                </span>
                <Link
                  href="/account"
                  title={user.email}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-1.5 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--accent)]"
                >
                  <Coins size={14} className="text-[var(--accent)]" />
                  {creditsLabel(credits, language, t)}
                </Link>
                <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                  {t.auth.signOut}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" disabled={loading} onClick={() => openAuth('sign-in')}>
                  {t.nav.signIn}
                </Button>
                <Button variant="primary" size="sm" disabled={loading} onClick={() => openAuth('sign-up')}>
                  {t.nav.startFree}
                </Button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMobileOpen((value) => !value)}
              aria-label={mobileOpen ? t.nav.closeMenu : t.nav.openMenu}
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink)]"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div id="mobile-menu" className="border-t border-[var(--border)] bg-[var(--bg)] px-5 py-4 md:hidden">
            <div className="mb-3 flex justify-center border-b border-[var(--border)] pb-3">
              <LanguageSwitcher />
            </div>
            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--ink)]"
                >
                  {t.nav[link.id]}
                </Link>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
              {user ? (
                <>
                  <p className="truncate px-3 text-center text-sm text-[var(--ink-muted)]">{user.email}</p>
                  <Link
                    href="/account"
                    onClick={() => setMobileOpen(false)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)]"
                  >
                    <Coins size={15} className="text-[var(--accent)]" />
                    {creditsLabel(credits, language, t)}
                  </Link>
                  <Button variant="secondary" size="md" className="w-full" onClick={() => void signOut()}>
                    {t.auth.signOut}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="md" className="w-full" disabled={loading} onClick={() => openAuth('sign-in')}>
                    {t.nav.signIn}
                  </Button>
                  <Button variant="primary" size="md" className="w-full" disabled={loading} onClick={() => openAuth('sign-up')}>
                    {t.nav.startFree}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <AuthDialog open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} />
    </>
  )
}
