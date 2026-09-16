import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { usePanRouter } from '../router'

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; replace?: boolean; scroll?: boolean }

/* next/link shim — internal hrefs route through the in-memory PAN router; external ones open normally. */
const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, onClick, prefetch: _p, replace, scroll: _s, children, ...rest }, ref) {
  void _p; void _s
  const router = usePanRouter()
  const external = /^(https?:)?\/\//.test(href) || href.startsWith('mailto:') || href.startsWith('tel:')
  return (
    <a ref={ref} href={href} onClick={(e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e)
      if (e.defaultPrevented || external || rest.target === '_blank' || e.metaKey || e.ctrlKey) return
      e.preventDefault()
      if (replace) router.replace(href); else router.push(href)
    }} {...rest}>{children}</a>
  )
})
export default Link
