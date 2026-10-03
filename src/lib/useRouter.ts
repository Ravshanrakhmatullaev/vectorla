import { useContext } from 'react'
import { RouterContext, type RouterContextValue } from '@/lib/routerContext'

export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext)
  if (!context) throw new Error('useRouter must be used within a RouterProvider')
  return context
}
