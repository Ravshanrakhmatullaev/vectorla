import { SectionHeading } from '@/components/ui/SectionHeading'
import { useCases } from '@/data/useCases'

export function UseCases() {
  return (
    <section id="use-cases" className="bg-[var(--bg-subtle)] px-5 py-20 sm:px-8">
      <SectionHeading
        eyebrow="Use Cases"
        title="Built for people who ship physical output"
        description="From screen to production — Vectorla is designed around real workflows, not just pretty demos."
      />

      <div className="mx-auto mt-12 grid max-w-6xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
        {useCases.map((useCase) => (
          <div
            key={useCase.title}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5"
          >
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <useCase.icon size={17} />
            </div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">{useCase.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">
              {useCase.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
