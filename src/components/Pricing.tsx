import { Check } from 'lucide-react'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Button } from '@/components/ui/Button'
import { Link } from '@/components/ui/Link'
import { pricingPlans } from '@/data/pricing'
import { useLanguage } from '@/lib/language'
import { useAuth } from '@/lib/useAuth'
import { requestAuthDialog } from '@/lib/authDialogEvents'
import { cn } from '@/utils/cn'

const CTA_CLASSES =
  'mt-6 inline-flex w-full items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-[0.98]'

export function Pricing() {
  const { t } = useLanguage()
  const { user } = useAuth()

  return (
    <section id="pricing" className="px-5 py-20 sm:px-8">
      <SectionHeading
        eyebrow={t.pricing.eyebrow}
        title={t.pricing.title}
        description={t.pricing.description}
      />

      <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-5 sm:grid-cols-2">
        {pricingPlans.map((plan) => {
          const text = t.pricing.plans[plan.id]
          return (
            <div
              key={plan.id}
              className={cn(
                'flex flex-col rounded-2xl border p-6',
                plan.highlighted
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-lg shadow-[var(--ring)]'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)]',
              )}
            >
              <h3 className="text-lg font-semibold text-[var(--ink)]">{text.name}</h3>
              <p
                className={cn(
                  'mt-2 font-[family-name:var(--font-display)] font-bold',
                  plan.comingSoon ? 'text-xl text-[var(--ink-muted)]' : 'text-3xl text-[var(--ink)]',
                )}
              >
                {text.price}
              </p>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">{text.description}</p>

              {text.features.length > 0 && (
                <ul className="mt-5 flex flex-col gap-2.5">
                  {text.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-[var(--ink)]">
                      <Check size={16} className="mt-0.5 flex-none text-[var(--accent)]" />
                      {feature}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto">
                {plan.comingSoon ? (
                  <Button variant="secondary" size="md" className="mt-6 w-full" disabled>
                    {text.cta}
                  </Button>
                ) : user ? (
                  <Link href="/#workspace" className={cn(CTA_CLASSES, 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]')}>
                    {t.hero.primaryCta}
                  </Link>
                ) : (
                  <Button size="md" className="mt-6 w-full" onClick={() => requestAuthDialog('sign-up')}>
                    {text.cta}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
