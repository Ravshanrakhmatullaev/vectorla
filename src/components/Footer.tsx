import { LogoMark } from '@/components/LogoMark'
import { Link } from '@/components/ui/Link'
import { useLanguage } from '@/lib/language'
import type { FooterColumnId } from '@/data/i18n'

const columnIds: FooterColumnId[] = ['product', 'legal']

// Same order as the link labels in t.footer.columns.
const columnHrefs: Record<FooterColumnId, string[]> = {
  product: ['/#features', '/#use-cases', '/#pricing', '/#faq'],
  legal: ['/privacy', '/terms'],
}

export function Footer() {
  const { t } = useLanguage()

  return (
    <footer className="border-t border-[var(--border)] px-5 py-14 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2">
              <LogoMark size={26} />
              <span className="font-[family-name:var(--font-display)] text-base font-bold text-[var(--ink)]">
                Vectorla
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-[var(--ink-muted)]">{t.footer.tagline}</p>
          </div>

          {columnIds.map((id) => {
            const column = t.footer.columns[id]
            return (
              <div key={id}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                  {column.title}
                </h2>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {column.links.map((link, index) => (
                    <li key={link}>
                      <Link
                        href={columnHrefs[id][index] ?? '/'}
                        className="text-sm text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
                      >
                        {link}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--border)] pt-6 text-xs text-[var(--ink-faint)] sm:flex-row">
          <span>{t.footer.copyright.replace('{year}', String(new Date().getFullYear()))}</span>
          <span>vectorla.app</span>
        </div>
      </div>
    </footer>
  )
}
