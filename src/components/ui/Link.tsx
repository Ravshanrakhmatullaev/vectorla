import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { useRouter } from '@/lib/useRouter'

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
}

/**
 * An <a> that navigates in-app for same-origin paths (no full reload), and
 * behaves like a normal link for modified clicks, new tabs and other origins.
 */
export function Link({ href, onClick, ...props }: LinkProps) {
  const { path, navigate } = useRouter()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (props.target && props.target !== '_self') return
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) return
    // Same page with only a hash: let the browser scroll natively.
    if (url.pathname === path && url.hash) return
    event.preventDefault()
    navigate(href)
  }

  return <a href={href} onClick={handleClick} {...props} />
}
