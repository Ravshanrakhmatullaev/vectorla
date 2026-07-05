import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { translations, type Language, type Translation } from '@/data/i18n'

interface LanguageContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: Translation
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

const STORAGE_KEY = 'vectorla-lang'

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'uz' || value === 'ru'
}

function getInitialLanguage(): Language {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isLanguage(stored) ? stored : 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage)

  useEffect(() => {
    document.documentElement.setAttribute('lang', language)
    window.localStorage.setItem(STORAGE_KEY, language)
  }, [language])

  const setLanguage = (next: Language) => setLanguageState(next)

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t: translations[language] }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
