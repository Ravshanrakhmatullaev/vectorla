import type { ReactNode } from 'react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { useLanguage } from '@/lib/language'

export function MainLayout({ children }: { children: ReactNode }) {
  const { t } = useLanguage()

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        {t.common.skipToContent}
      </a>
      <Navbar />
      <main id="main-content">{children}</main>
      <Footer />
    </div>
  )
}
