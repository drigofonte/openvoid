import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface CardProps {
  padding?: string
  children?: RemixNode
}

/**
 * Surface primitive — 1px line, 10px radius, white background. Maps
 * to `wireframe-primitives.jsx`'s `WF.card` / `.wf-card` class.
 */
export function Card() {
  return ({ padding, children }: CardProps) => (
    <div class="wf-card" mix={padding ? css({ padding }) : undefined}>
      {children}
    </div>
  )
}
