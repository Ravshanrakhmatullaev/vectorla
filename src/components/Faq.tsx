import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { faqItems } from '@/data/faq'
import { cn } from '@/utils/cn'

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section id="docs" className="bg-[var(--bg-subtle)] px-5 py-20 sm:px-8">
      <SectionHeading eyebrow="FAQ" title="Frequently asked questions" />

      <div className="mx-auto mt-10 max-w-2xl">
        {faqItems.map((item, index) => {
          const isOpen = openIndex === index
          return (
            <div key={item.question} className="border-b border-[var(--border)]">
              <button
                onClick={() => setOpenIndex(isOpen ? null : index)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 py-4 text-left"
              >
                <span className="text-sm font-semibold text-[var(--ink)] sm:text-[15px]">
                  {item.question}
                </span>
                <ChevronDown
                  size={18}
                  className={cn(
                    'flex-none text-[var(--ink-faint)] transition-transform duration-150',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
              {isOpen && (
                <p className="max-w-xl pb-4 text-sm leading-relaxed text-[var(--ink-muted)]">
                  {item.answer}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
