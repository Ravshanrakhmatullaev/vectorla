import type { ReactNode } from 'react'
import { ArrowLeft, FileWarning } from 'lucide-react'
import { Link } from '@/components/ui/Link'
import { useLanguage } from '@/lib/language'

/**
 * Marks text the owner still has to decide (legal entity, contact, law,
 * retention period…). Rendered visibly on purpose: these drafts must not
 * go live with open decisions hidden.
 */
export function Decision({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-amber-200/70 px-1 py-0.5 font-medium text-amber-950 dark:bg-amber-400/25 dark:text-amber-100">
      [Decision needed: {children}]
    </mark>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--ink)]">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-[var(--ink-muted)] [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </section>
  )
}

export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <article className="px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft size={15} />
          {t.legal.backHome}
        </Link>

        <h1 className="mt-6 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-faint)]">{updated}</p>
        {t.legal.englishOnly && <p className="mt-2 text-sm text-[var(--ink-muted)]">{t.legal.englishOnly}</p>}

        <div
          role="note"
          className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
        >
          <FileWarning size={18} className="mt-0.5 flex-none" />
          <p>
            Draft for review. This document has not been reviewed by a lawyer yet, and items marked
            "Decision needed" are still open. It will be finalized before Vectorla launches publicly.
          </p>
        </div>

        {children}
      </div>
    </article>
  )
}
