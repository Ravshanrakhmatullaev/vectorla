import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { LogoMark } from '@/components/LogoMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/Button'
import { navLinks } from '@/data/nav'

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
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
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
          <Button variant="primary" size="sm">
            Start free
          </Button>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink)]"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-[var(--border)] bg-[var(--bg)] px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--ink)]"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            <Button variant="secondary" size="md" className="w-full">
              Sign in
            </Button>
            <Button variant="primary" size="md" className="w-full">
              Start free
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}
