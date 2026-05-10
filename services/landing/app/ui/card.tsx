import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface CardProps {
  /**
   * Surface variant:
   *
   * - `line` (default) — `<div class="wf-card">` — 1px line, 10px
   *   radius, white background. Today's shape.
   * - `elevated` — `<div class="wf-card-elev">` — canonical Tokens
   *   elevated card (14px radius, --shadow-2, hover-lift).
   */
  variant?: 'line' | 'elevated'
  /**
   * Toggles a thin accent-tinted gradient strip across the top
   * edge of an elevated card via the `[data-accent-top]` data
   * attribute (CUBE Exception layer in `exceptions.css`).
   * Ignored on the `line` variant.
   */
  accentTop?: boolean
  padding?: string
  children?: RemixNode
}

/**
 * Surface primitive — paper-on-paper card. The default `line`
 * variant maps to the existing `.wf-card` rule; the `elevated`
 * variant maps to `.wf-card-elev` (with optional `[data-accent-top]`
 * attribute toggling the Exception-layer gradient strip).
 */
export function Card() {
  return ({ variant = 'line', accentTop, padding, children }: CardProps) => {
    const className = variant === 'elevated' ? 'wf-card-elev' : 'wf-card'
    const mix = padding ? css({ padding }) : undefined
    if (variant === 'elevated' && accentTop) {
      return (
        <div class={className} data-accent-top="" mix={mix}>
          {children}
        </div>
      )
    }
    return (
      <div class={className} mix={mix}>
        {children}
      </div>
    )
  }
}
