import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface StackProps {
  /** Vertical gap between children. Defaults to `var(--space-s)`. */
  space?: string
  /** When true, the spacing rule applies to all descendants, not just direct children. */
  recursive?: boolean
  id?: string
  children?: RemixNode
}

/**
 * Every Layout Stack — vertical flow with consistent spacing between
 * direct children (or all descendants when `recursive` is set).
 * Layout mechanics live in `composition.css`'s `.stack` /
 * `.stack-recursive` rules; this component sets the `--space` custom
 * property.
 *
 * The original React port carried a `splitAfter` numeric prop that
 * wrapped the Nth child in `<div class="stack-split">` to push
 * subsequent siblings to the bottom. Remix 3 has no `Children.toArray`
 * equivalent, so the Remix port asks consumers to tag the boundary
 * directly:
 *
 *   <Stack>
 *     <header>…</header>
 *     <div class="stack-split">{mainContent}</div>
 *     <footer>…</footer>
 *   </Stack>
 *
 * `composition.css`'s `.stack-split { margin-block-end: auto }` rule
 * does the rest. This makes the split boundary visible at the call
 * site and removes a layer of indirection.
 */
export function Stack() {
  return ({ space = 'var(--space-s)', recursive = false, id, children }: StackProps) => (
    <div
      class={recursive ? 'stack stack-recursive' : 'stack'}
      id={id}
      mix={css({ '--space': space })}
    >
      {children}
    </div>
  )
}
