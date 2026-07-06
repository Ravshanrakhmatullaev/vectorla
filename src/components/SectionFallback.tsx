import { Loader2 } from 'lucide-react'
import { useLanguage } from '@/lib/language'

/** Suspense fallback shown while a lazy-loaded landing page section's chunk is fetched. */
export function SectionFallback() {
  const { t } = useLanguage()

  return (
    <div role="status" aria-label={t.common.loading} className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-[var(--accent)]" size={28} aria-hidden="true" />
    </div>
  )
}
