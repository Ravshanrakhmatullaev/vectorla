import type { NavId } from '@/data/i18n'

export interface NavLink {
  id: NavId
  href: string
}

export const navLinks: NavLink[] = [
  { id: 'features', href: '#features' },
  { id: 'useCases', href: '#use-cases' },
  { id: 'pricing', href: '#pricing' },
  { id: 'api', href: '#api' },
  { id: 'docs', href: '#docs' },
]
