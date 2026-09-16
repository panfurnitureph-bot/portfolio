/* Scroll-reveal helpers (motion): fade + rise once when the element enters the viewport.
   Respects prefers-reduced-motion by rendering static. */
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'
import type { ElementType, ReactNode } from 'react'

const EASE = [0.16, 1, 0.3, 1] as const
export const VIEWPORT = { once: true, margin: '0px 0px 80px 0px' } as const

type Props = {
  children?: ReactNode
  as?: 'div' | 'section' | 'article' | 'li' | 'p' | 'h2' | 'span'
  className?: string
  /** rise distance in px */
  y?: number
  delay?: number
  duration?: number
  /** how much of the element must be visible (0..1) */
  amount?: number
  style?: React.CSSProperties
  id?: string
}

export function Reveal({ children, as = 'div', className, y = 24, delay = 0, duration = 0.55, amount = 0.2, style, id }: Props) {
  const reduce = useReducedMotion()
  const Tag = (motion as unknown as Record<string, ElementType>)[as] as ElementType<HTMLMotionProps<'div'>>
  if (reduce) { const Plain = as as ElementType; return <Plain className={className} style={style} id={id}>{children}</Plain> }
  return (
    <Tag className={className} style={style} id={id} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ ...VIEWPORT, amount }} transition={{ duration, delay, ease: EASE }}>
      {children}
    </Tag>
  )
}

/** Hero entrance: mount-time fade/rise with a delay (no viewport gating). */
export function Enter({ children, as = 'div', className, y = 16, delay = 0, duration = 0.6, scale, style }: Props & { scale?: number }) {
  const reduce = useReducedMotion()
  const Tag = (motion as unknown as Record<string, ElementType>)[as] as ElementType<HTMLMotionProps<'div'>>
  if (reduce) { const Plain = as as ElementType; return <Plain className={className} style={style}>{children}</Plain> }
  return (
    <Tag className={className} style={style} initial={{ opacity: 0, y, scale: scale ?? 1 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration, delay, ease: EASE }}>
      {children}
    </Tag>
  )
}
