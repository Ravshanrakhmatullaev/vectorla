import { languageOptions } from '@/data/i18n'
import { useLanguage } from '@/lib/language'
import { cn } from '@/utils/cn'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { language, setLanguage } = useLanguage()

  return (
    <div
      className={cn(
        'inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5',
        className,
      )}
    >
      {languageOptions.map((option) => (
        <button
          key={option.code}
          type="button"
          onClick={() => setLanguage(option.code)}
          aria-pressed={language === option.code}
          aria-label={`Switch language to ${option.label}`}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
            language === option.code
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
