import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export type StatusVariant = 'ok' | 'acc' | 'warn' | 'danger' | 'idle'

export interface StatusDotProps {
  variant?: StatusVariant
  children?: RemixNode
}

/**
 * Coloured dot + optional label. Wireframe canvas uses these as
 * inline session-state indicators (e.g. "● session live", "● ending
 * session"). Maps to `.wf-dot-*` classes.
 *
 * Prop name aligns with Button / Chip's `variant` for API
 * consistency across primitives.
 */
export function StatusDot() {
  return ({ variant = 'idle', children }: StatusDotProps) => {
    let cls = 'wf-dot'
    if (variant === 'ok') cls += ' wf-dot-ok'
    else if (variant === 'acc') cls += ' wf-dot-acc'
    else if (variant === 'warn') cls += ' wf-dot-warn'
    else if (variant === 'danger') cls += ' wf-dot-danger'

    return (
      <div class="wf-row" mix={css({ gap: '6px' })}>
        <span class={cls} />
        {children ? <span class="wf-muted" mix={css({ fontSize: '12px' })}>{children}</span> : null}
      </div>
    )
  }
}
