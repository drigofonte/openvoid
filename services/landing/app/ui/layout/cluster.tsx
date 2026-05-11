import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface ClusterProps {
  /** Gap between children. Defaults to `var(--space-s)`. */
  space?: string
  /** Maps to `justify-content`. Defaults to `flex-start`. */
  justify?: string
  /** Maps to `align-items`. Defaults to `center`. */
  align?: string
  id?: string
  children?: RemixNode
}

/**
 * Every Layout Cluster — wraps inline-block-style children with a
 * uniform gap, wrapping onto new lines when they exceed the
 * container's inline-size. Layout mechanics live in
 * `layout-primitives/cluster.css`'s `.cluster` rule; this component sets the
 * `--space`, `--justify`, `--align` custom properties.
 */
export function Cluster() {
  return ({
    space = 'var(--space-s)',
    justify = 'flex-start',
    align = 'center',
    id,
    children,
  }: ClusterProps) => (
    <div
      class="cluster"
      id={id}
      mix={css({ '--space': space, '--justify': justify, '--align': align })}
    >
      {children}
    </div>
  )
}
