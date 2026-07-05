import { compatibleApps } from '@/data/compatibleApps'
import { useLanguage } from '@/lib/language'

export function CompatibleWith() {
  const { t } = useLanguage()

  return (
    <section className="px-5 pb-16 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
          {t.compatibleWith.title}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {compatibleApps.map((app) => (
            <span
              key={app}
              className="text-sm font-semibold text-[var(--ink-muted)] opacity-70 transition-opacity hover:opacity-100"
            >
              {app}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
