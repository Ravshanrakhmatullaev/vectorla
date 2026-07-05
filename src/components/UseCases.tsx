import { SectionHeading } from '@/components/ui/SectionHeading'
import { useCases } from '@/data/useCases'
import { useLanguage } from '@/lib/language'

export function UseCases() {
  const { t } = useLanguage()

  return (
    <section id="use-cases" className="bg-[var(--bg-subtle)] px-5 py-20 sm:px-8">
      <SectionHeading
        eyebrow={t.useCases.eyebrow}
        title={t.useCases.title}
        description={t.useCases.description}
      />

      <div className="mx-auto mt-12 grid max-w-6xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
        {useCases.map((useCase) => {
          const item = t.useCases.items[useCase.id]
          return (
            <div
              key={useCase.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <useCase.icon size={17} />
              </div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">
                {item.description}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
