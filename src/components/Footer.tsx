import { LogoMark } from '@/components/LogoMark'

const columns = [
  {
    title: 'Product',
    links: ['Features', 'Use Cases', 'Pricing', 'Changelog'],
  },
  {
    title: 'Resources',
    links: ['Docs', 'API Reference', 'Guides', 'Support'],
  },
  {
    title: 'Company',
    links: ['About', 'Blog', 'Careers', 'Contact'],
  },
  {
    title: 'Legal',
    links: ['Privacy Policy', 'Terms of Service', 'Security'],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] px-5 py-14 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <div className="flex items-center gap-2">
              <LogoMark size={26} />
              <span className="font-[family-name:var(--font-display)] text-base font-bold text-[var(--ink)]">
                Vectorla
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-[var(--ink-muted)]">
              The AI print-ready vector platform for designers, print shops, and production
              teams.
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                {col.title}
              </h4>
              <ul className="mt-3 flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--border)] pt-6 text-xs text-[var(--ink-faint)] sm:flex-row">
          <span>&copy; {new Date().getFullYear()} Vectorla. All rights reserved.</span>
          <span>vectorla.app</span>
        </div>
      </div>
    </footer>
  )
}
