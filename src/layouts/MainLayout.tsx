import type { ReactNode } from 'react'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'

export function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
