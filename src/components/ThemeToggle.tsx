import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useLanguage } from '@/lib/language'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const { t } = useLanguage()
  const label = theme === 'dark' ? t.common.switchToLightMode : t.common.switchToDarkMode

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)] hover:bg-[var(--bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${className}`}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
