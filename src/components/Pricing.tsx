import { Check } from 'lucide-react'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Button } from '@/components/ui/Button'
import { pricingPlans } from '@/data/pricing'
import { cn } from '@/utils/cn'

export function Pricing() {
  return (
    <section id="pricing" className="px-5 py-20 sm:px-8">
      <SectionHeading
        eyebrow="Pricing"
        title="Simple pricing that scales with you"
        description="Start free. Upgrade when you need batch processing and production-grade export."
      />

      <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-3">
        {pricingPlans.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              'flex flex-col rounded-2xl border p-6',
              plan.highlighted
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-lg shadow-[var(--ring)]'
                : 'border-[var(--border)] bg-[var(--bg-elevated)]',
            )}
          >
            {plan.highlighted && (
              <span className="mb-3 inline-block w-fit rounded-full bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-white">
                Most popular
              </span>
            )}
            <h3 className="text-lg font-semibold text-[var(--ink)]">{plan.name}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--ink)]">
                {plan.price}
              </span>
              {plan.period && (
                <span className="text-sm text-[var(--ink-muted)]">{plan.period}</span>
              )}
            </div>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">{plan.description}</p>

            <ul className="mt-5 flex flex-1 flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-[var(--ink)]">
                  <Check size={16} className="mt-0.5 flex-none text-[var(--accent)]" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              variant={plan.highlighted ? 'primary' : 'secondary'}
              size="md"
              className="mt-6 w-full"
            >
              {plan.cta}
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
