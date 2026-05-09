import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface CoverProps {
  /** Vertical gap above and below the centered content. Defaults to `var(--space-m)`. */
  space?: string
  /** Minimum block-size for the cover container. Defaults to `100vh`. */
  minHeight?: string
  /** When true, drops the container's outer padding. */
  noPad?: boolean
  /**
   * The centered content. Wrapped server-side in `<div class="cover-centered">`
   * so `composition.css`'s `.cover > .cover-centered { margin-block: auto }`
   * pushes it to the vertical center regardless of position.
   */
  centered: RemixNode
  /** Optional content rendered after the centered block. */
  children?: RemixNode
  id?: string
}

/**
 * Every Layout Cover — a viewport-height block with one piece of
 * content vertically centered, optionally with content above or
 * below. Layout mechanics live in `composition.css`'s `.cover` /
 * `.cover-centered` rules.
 *
 * The original React port walked `children` and wrapped the first
 * child in `<div class="cover-centered">`. Remix 3 has no
 * `Children.map` equivalent, so the Remix port surfaces the centered
 * slot as an explicit `centered` prop. Anything passed as `children`
 * renders after it.
 */
export function Cover() {
  return ({
    space = 'var(--space-m)',
    minHeight = '100vh',
    noPad = false,
    centered,
    children,
    id,
  }: CoverProps) => (
    <div
      class="cover"
      id={id}
      mix={css({
        '--min-height': minHeight,
        '--space': space,
        '--padding': noPad ? '0' : space,
      })}
    >
      <div class="cover-centered">{centered}</div>
      {children}
    </div>
  )
}
