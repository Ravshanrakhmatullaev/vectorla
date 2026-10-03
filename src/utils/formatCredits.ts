import type { Language, Translation } from '@/data/i18n'

/** "1 credit", "3 кредита", "5 кредитов" — CLDR plural categories per language. */
export function formatCredits(count: number, language: Language, unit: Translation['credits']['unit']): string {
  const category = new Intl.PluralRules(language).select(count)
  const word = category === 'one' ? unit.one : category === 'few' ? unit.few : unit.many
  return `${count.toLocaleString(language)} ${word}`
}
