import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { UploadCloud, Wand2, Download, ArrowRight } from 'lucide-react'
import { Link } from '@/components/ui/Link'
import { BeforeAfterArt } from '@/components/BeforeAfterArt'
import { trustBadges } from '@/data/trustBadges'
import { useLanguage } from '@/lib/language'
import { useCompareSlider } from '@/hooks/useCompareSlider'
import { cn } from '@/utils/cn'

// The real upload lives in the workspace section; the hero links to it.
const WORKSPACE_HREF = '/#workspace'

export function Hero() {
  const { splitPct, containerHandlers, onHandleKeyDown } = useCompareSlider(52)
  const [activeStep, setActiveStep] = useState(0)
  const { t } = useLanguage()

  useEffect(() => {
    const id = setInterval(() => setActiveStep((step) => (step + 1) % 3), 1800)
    return () => clearInterval(id)
  }, [])

  const workflowSteps = [
    { icon: UploadCloud, label: t.hero.workflow.upload },
    { icon: Wand2, label: t.hero.workflow.trace },
    { icon: Download, label: t.hero.workflow.export },
  ]

  return (
    <section id="top" className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
      {/* premium gradient backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent-soft),transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-0 -z-10 h-96 w-96 rounded-full bg-gradient-to-br from-[var(--accent)] to-sky-500 opacity-20 blur-3xl dark:opacity-30"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 top-72 -z-10 h-72 w-72 rounded-full bg-gradient-to-br from-fuchsia-500 to-[var(--accent)] opacity-10 blur-3xl dark:opacity-20"
      />

      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2 lg:gap-10">
          {/* LEFT: copy + CTAs + trust */}
          <div className="text-center lg:text-left">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              {t.hero.badge}
            </span>

            <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-[var(--ink)] sm:text-5xl lg:text-6xl">
              {t.hero.title}
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base text-[var(--ink-muted)] sm:text-lg lg:mx-0">
              {t.hero.description}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link
                href={WORKSPACE_HREF}
                className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-[var(--accent)] px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-[0.98]"
              >
                <UploadCloud size={18} />
                {t.hero.primaryCta}
              </Link>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 lg:justify-start">
              {trustBadges.map((badge) => (
                <div key={badge.id} className="flex items-center gap-1.5 text-xs text-[var(--ink-faint)]">
                  <badge.icon size={13} className="text-[var(--accent)]" />
                  {t.trustBadges[badge.id]}
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: interactive upload card */}
          <div className="relative">
            <div className="relative rounded-3xl border border-white/40 bg-white/60 p-5 shadow-2xl shadow-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-white/5 sm:p-6">
              {/* drag & drop area */}
              <Link
                href={WORKSPACE_HREF}
                className="group flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)]/60 px-4 py-7 text-center transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <UploadCloud className="text-[var(--accent)]" size={26} />
                <span className="text-sm font-semibold text-[var(--ink)]">{t.hero.dragDropTitle}</span>
                <span className="text-xs text-[var(--ink-faint)]">{t.hero.dragDropSubtitle}</span>
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-3.5 py-2 text-sm font-semibold text-[var(--ink)] transition-colors group-hover:bg-[var(--border)]">
                  {t.hero.browseFiles}
                  <ArrowRight size={14} />
                </span>
              </Link>

              {/* animated vectorization workflow */}
              <div className="relative mt-6 flex items-center justify-between px-3">
                <div
                  aria-hidden="true"
                  className="absolute left-7 right-7 top-4 h-0.5 bg-[var(--border)]"
                />
                <motion.div
                  aria-hidden="true"
                  className="absolute top-4 h-0.5 bg-[var(--accent)]"
                  style={{ left: '1.75rem' }}
                  animate={{ width: `calc(${(activeStep / 2) * 100}% - ${3.5 * (activeStep / 2)}rem)` }}
                  transition={{ duration: 0.5, ease: 'easeInOut' }}
                />
                {workflowSteps.map((step, index) => (
                  <div key={step.label} className="relative z-10 flex flex-col items-center gap-1.5">
                    <motion.div
                      animate={{ scale: activeStep === index ? 1.15 : 1 }}
                      transition={{ duration: 0.4, ease: 'easeInOut' }}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-300',
                        activeStep === index
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-[var(--bg-muted)] text-[var(--ink-muted)]',
                      )}
                    >
                      <step.icon size={14} />
                    </motion.div>
                    <span className="text-[10px] font-medium text-[var(--ink-faint)]">{step.label}</span>
                  </div>
                ))}
              </div>

              {/* before/after comparison slider */}
              <div
                className="relative mt-6 aspect-[4/3] select-none overflow-hidden rounded-xl bg-[var(--bg-subtle)]"
                {...containerHandlers}
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-0 opacity-40 [background-image:linear-gradient(45deg,var(--border)_25%,transparent_25%),linear-gradient(-45deg,var(--border)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--border)_75%),linear-gradient(-45deg,transparent_75%,var(--border)_75%)] [background-position:0_0,0_10px,10px_-10px,-10px_0] [background-size:20px_20px]"
                />

                <div className="absolute inset-0 flex items-center justify-center p-8">
                  <div className="h-full w-full max-w-[200px]">
                    <BeforeAfterArt crisp={false} />
                  </div>
                </div>

                <div
                  className="absolute inset-0 flex items-center justify-center p-8"
                  style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
                >
                  <div className="h-full w-full max-w-[200px]">
                    <BeforeAfterArt crisp />
                  </div>
                </div>

                <div
                  className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.1)]"
                  style={{ left: `${splitPct}%` }}
                />
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label={t.common.compareSliderLabel}
                  aria-orientation="horizontal"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(splitPct)}
                  onKeyDown={onHandleKeyDown}
                  className="absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  style={{ left: `${splitPct}%` }}
                >
                  <div className="flex gap-0.5">
                    <div className="h-2.5 w-0.5 rounded bg-[var(--ink-faint)]" />
                    <div className="h-2.5 w-0.5 rounded bg-[var(--ink-faint)]" />
                  </div>
                </div>

                <span className="absolute left-2.5 top-2.5 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-white">
                  {t.hero.original}
                </span>
                <span className="absolute right-2.5 top-2.5 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-white">
                  {t.hero.vectorized}
                </span>
              </div>
              <p className="mt-2 text-center text-[11px] text-[var(--ink-faint)]">{t.hero.dragHint}</p>

              {/* output format — SVG is the only format the engine produces today */}
              <div className="mt-5 flex justify-center">
                <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1 text-[11px] font-semibold text-[var(--ink-muted)]">
                  SVG
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
