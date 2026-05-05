import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export type StatusKind = 'ok' | 'acc' | 'warn' | 'danger' | 'idle'

export interface StatusDotProps {
  kind?: StatusKind
  children?: RemixNode
}

/**
 * Coloured dot + optional label. Wireframe canvas uses these as
 * inline session-state indicators (e.g. "● session live", "● ending
 * session"). Maps to `.wf-dot-*` classes.
 */
export function StatusDot() {
  return ({ kind = 'idle', children }: StatusDotProps) => {
    let cls = 'wf-dot'
    if (kind === 'ok') cls += ' wf-dot-ok'
    else if (kind === 'acc') cls += ' wf-dot-acc'
    else if (kind === 'warn') cls += ' wf-dot-warn'
    else if (kind === 'danger') cls += ' wf-dot-danger'

    return (
      <div class="wf-row" mix={css({ gap: '6px' })}>
        <span class={cls} />
        {children ? <span class="wf-muted" mix={css({ fontSize: '12px' })}>{children}</span> : null}
      </div>
    )
  }
}
