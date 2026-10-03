import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { RouterContext } from '@/lib/routerContext'

// Pages are few and static (/, /account, /privacy, /terms), so this is a
// minimal History-API router rather than a routing library. Cloudflare Pages
// serves index.html for unknown paths (SPA fallback), so deep links work.

function scrollToHash(hash: string) {
  if (!hash) {
    window.scrollTo({ top: 0 })
    return
  }
  // Landing sections are lazy-loaded, so the target may not exist yet.
  let attempts = 0
  const tryScroll = () => {
    const target = document.getElementById(decodeURIComponent(hash.slice(1)))
    if (target) target.scrollIntoView()
    else if (attempts++ < 40) window.setTimeout(tryScroll, 50)
  }
  tryScroll()
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((href: string) => {
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) {
      window.location.assign(url.href)
      return
    }
    window.history.pushState(null, '', url.pathname + url.search + url.hash)
    setPath(url.pathname)
    scrollToHash(url.hash)
  }, [])

  const value = useMemo(() => ({ path, navigate }), [path, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}
