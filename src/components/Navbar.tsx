import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { AuthDialog, type AuthDialogMode } from '@/components/AuthDialog'
import { LogoMark } from '@/components/LogoMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Button } from '@/components/ui/Button'
import { navLinks } from '@/data/nav'
import { useAuth } from '@/lib/useAuth'
import { useLanguage } from '@/lib/language'

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthDialogMode>('sign-in')
  const { t } = useLanguage()
  const { user, loading, passwordRecovery, signOut } = useAuth()

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

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <LogoMark size={30} />
            <span className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--ink)]">
              Vectorla
            </span>
          </a>

          <nav className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
              >
                {t.nav[link.id]}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <LanguageSwitcher />
            <ThemeToggle />
            {user ? (
              <>
                <span className="max-w-40 truncate text-sm text-[var(--ink-muted)]" title={user.email}>
                  {user.email}
                </span>
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
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--ink)]"
                >
                  {t.nav[link.id]}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
              {user ? (
                <>
                  <p className="truncate px-3 text-center text-sm text-[var(--ink-muted)]">{user.email}</p>
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
