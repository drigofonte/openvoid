import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface KickerProps {
  /** Tone — `default` is muted; `accent` highlights in the warm-orange brand colour; `danger` for destructive sections; `ok` for success states. */
  tone?: 'default' | 'accent' | 'danger' | 'ok'
  children?: RemixNode
}

/**
 * Kicker — a short uppercase letter-spaced label that sits above
 * a heading. "Kicker" is the established journalism / editorial-
 * typography term for this shape. Maps to the `.kicker` block in
 * `blocks/typography.css`.
 *
 * NOT the canonical `.eyebrow` pill (see `OpenVoid Blocks.html`).
 * When canonical `.eyebrow` lands as a pill block, call sites that
 * want a pill explicitly switch; this component stays the flat
 * typography label.
 */
export function Kicker() {
  return ({ tone = 'default', children }: KickerProps) => {
    let toneOverride =
      tone === 'accent'
        ? css({ color: 'var(--wf-accent)' })
        : tone === 'danger'
          ? css({ color: 'var(--wf-danger)' })
          : tone === 'ok'
            ? css({ color: 'var(--wf-ok)' })
            : undefined
    return (
      <span class="kicker" mix={toneOverride}>
        {children}
      </span>
    )
  }
}
