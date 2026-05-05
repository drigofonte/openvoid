import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface EyebrowProps {
  /** Tone — `default` is muted; `accent` highlights in the warm-orange brand colour; `danger` for destructive sections. */
  tone?: 'default' | 'accent' | 'danger' | 'ok'
  children?: RemixNode
}

/**
 * Small uppercase mono-letter section label. Maps to
 * `wireframe-primitives.jsx`'s `.wf-eyebrow` class with optional tone.
 */
export function Eyebrow() {
  return ({ tone = 'default', children }: EyebrowProps) => {
    let toneOverride =
      tone === 'accent'
        ? css({ color: 'var(--wf-accent)' })
        : tone === 'danger'
          ? css({ color: 'var(--wf-danger)' })
          : tone === 'ok'
            ? css({ color: 'var(--wf-ok)' })
            : undefined
    return (
      <span class="wf-eyebrow" mix={toneOverride}>
        {children}
      </span>
    )
  }
}
