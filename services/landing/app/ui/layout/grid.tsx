import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface GridProps {
  /** Minimum column width before the grid wraps. Defaults to `250px`. */
  min?: string
  /** Gap between cells. Defaults to `var(--space-m)`. */
  space?: string
  id?: string
  children?: RemixNode
}

/**
 * Every Layout Grid — auto-fitting CSS grid that maintains a minimum
 * column width and reflows columns based on container size. Layout
 * mechanics live in `composition.css`'s `.grid` rule; this component
 * sets the `--grid-min` and `--space` custom properties.
 */
export function Grid() {
  return ({ min = '250px', space = 'var(--space-m)', id, children }: GridProps) => (
    <div class="grid" id={id} mix={css({ '--grid-min': min, '--space': space })}>
      {children}
    </div>
  )
}
