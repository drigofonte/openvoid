import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface ReelProps {
  /** Width of each child. `auto` lets children size themselves. */
  itemWidth?: string
  /** Inline gap between children. Defaults to `var(--space-s)`. */
  space?: string
  /** Block-size of the reel container. */
  height?: string
  /** When true, hides the horizontal scrollbar (adds `.reel-no-bar`). */
  noBar?: boolean
  id?: string
  children?: RemixNode
}

/**
 * Every Layout Reel — a horizontal-scrolling row of fixed-width items.
 * Layout mechanics live in `composition.css`'s `.reel` rule; this
 * component sets `--item-width`, `--space`, `--reel-height` custom
 * properties and toggles the `.reel-no-bar` class for chrome-less
 * variants.
 */
export function Reel() {
  return ({
    itemWidth = 'auto',
    space = 'var(--space-s)',
    height = 'auto',
    noBar = false,
    id,
    children,
  }: ReelProps) => (
    <div
      class={noBar ? 'reel reel-no-bar' : 'reel'}
      id={id}
      mix={css({ '--item-width': itemWidth, '--space': space, '--reel-height': height })}
    >
      {children}
    </div>
  )
}
