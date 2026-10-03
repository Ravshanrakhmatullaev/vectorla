import { createContext } from 'react'

export interface RouterContextValue {
  path: string
  navigate: (href: string) => void
}

export const RouterContext = createContext<RouterContextValue | undefined>(undefined)
