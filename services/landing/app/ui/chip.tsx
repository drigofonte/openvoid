import type { RemixNode } from 'remix/ui'

export type ChipVariant = 'default' | 'accent' | 'ok' | 'warn' | 'danger'

export interface ChipProps {
  variant?: ChipVariant
  children?: RemixNode
}

/**
 * Pill-shaped status / metadata indicator. Variants from
 * `wireframe-primitives.jsx`'s `.wf-chip-*` classes.
 */
export function Chip() {
  return ({ variant = 'default', children }: ChipProps) => {
    let cls = 'wf-chip'
    if (variant === 'accent') cls += ' wf-chip-acc'
    else if (variant === 'ok') cls += ' wf-chip-ok'
    else if (variant === 'warn') cls += ' wf-chip-warn'
    else if (variant === 'danger') cls += ' wf-chip-danger'

    return <span class={cls}>{children}</span>
  }
}
