import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface SidebarProps {
  /** Which side the sidebar sits on. Defaults to `left`. */
  side?: 'left' | 'right'
  /** Width of the sidebar column. Defaults to `20rem`. */
  sideWidth?: string
  /** Minimum inline-size of the content column. Defaults to `50%`. */
  contentMin?: string
  /** Inline gap between sidebar and content. Defaults to `var(--space-l)`. */
  space?: string
  id?: string
  children?: RemixNode
}

/**
 * Every Layout Sidebar — a two-column flex layout that collapses to
 * a stack when the content column would drop below `contentMin`.
 * Layout mechanics live in `composition.css`'s `.sidebar` /
 * `.sidebar-right` rules; this component sets `--side-width`,
 * `--content-min`, `--space` custom properties and toggles the
 * `.sidebar-right` class for right-anchored variants.
 */
export function Sidebar() {
  return ({
    side = 'left',
    sideWidth = '20rem',
    contentMin = '50%',
    space = 'var(--space-l)',
    id,
    children,
  }: SidebarProps) => (
    <div
      class={side === 'right' ? 'sidebar sidebar-right' : 'sidebar'}
      id={id}
      mix={css({
        '--side-width': sideWidth,
        '--content-min': contentMin,
        '--space': space,
      })}
    >
      {children}
    </div>
  )
}
