/* next/image shim: a plain <img>. `fill` becomes absolute positioning inside the (relative) parent, the
   way Next lays it out; the object-fit class on the element still applies. Optimisation props are dropped. */
import { forwardRef, type CSSProperties, type ImgHTMLAttributes } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height' | 'placeholder'> & {
  src: string | { src: string }
  alt: string
  fill?: boolean
  width?: number | string
  height?: number | string
  sizes?: string
  priority?: boolean
  quality?: number
  unoptimized?: boolean
  placeholder?: string
  blurDataURL?: string
  loader?: unknown
}

const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' }

const Image = forwardRef<HTMLImageElement, Props>(function Image({ src, fill, width, height, priority, quality: _q, unoptimized: _u, placeholder: _p, blurDataURL: _b, loader: _l, style, sizes: _s, ...rest }, ref) {
  void _q; void _u; void _p; void _b; void _l; void _s
  const url = typeof src === 'string' ? src : src.src
  return <img ref={ref} src={url} width={fill ? undefined : width} height={fill ? undefined : height} loading={priority ? 'eager' : 'lazy'} decoding="async" style={fill ? { ...FILL, ...style } : style} {...rest} />
})
export default Image
