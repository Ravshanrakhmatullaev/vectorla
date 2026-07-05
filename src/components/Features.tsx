import { SectionHeading } from '@/components/ui/SectionHeading'
import { features } from '@/data/features'

export function Features() {
  return (
    <section id="features" className="px-5 py-20 sm:px-8">
      <SectionHeading
        eyebrow="Features"
        title="Everything a production pipeline needs"
        description="Not just tracing — a full toolkit for turning raster images into usable, print-ready vectors."
      />

      <div className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="group rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <feature.icon size={19} />
            </div>
            <h3 className="text-[15px] font-semibold text-[var(--ink)]">{feature.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-muted)]">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
