import { css } from 'remix/ui'

export interface AvatarProps {
  letter?: string
}

/**
 * Decorative initial-circle avatar. v1 has no auth — every render
 * shows a static "M" (the wireframe canvas's stand-in user). When
 * auth lands the letter becomes per-session.
 */
export function Avatar() {
  return ({ letter = 'M' }: AvatarProps) => (
    <span
      aria-hidden="true"
      class="wf-row"
      mix={css({
        width: '28px',
        height: '28px',
        borderRadius: '999px',
        background: 'var(--wf-accent-soft)',
        color: 'var(--wf-accent)',
        font: '600 12.5px/1 var(--wf-font)',
        justifyContent: 'center',
        alignItems: 'center',
      })}
    >
      {letter}
    </span>
  )
}
