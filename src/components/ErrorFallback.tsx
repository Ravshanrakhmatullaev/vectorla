import { Button } from '@/components/ui/Button'
import { useLanguage } from '@/lib/language'

export function ErrorFallback() {
  const { t } = useLanguage()

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-5 text-center">
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--ink)]">
        {t.common.errorTitle}
      </h2>
      <p className="max-w-md text-sm text-[var(--ink-muted)]">{t.common.errorDescription}</p>
      <Button onClick={() => window.location.reload()}>{t.common.reloadPage}</Button>
    </div>
  )
}
