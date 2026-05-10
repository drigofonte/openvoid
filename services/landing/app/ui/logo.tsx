import { css } from 'remix/ui'

export interface LogoProps {
  /** Wordmark font-size in px (defaults to 13). Ignored when `tall` is set. */
  size?: number
  /**
   * Tall variant — 22px mark + 15px wordmark, matching the
   * canonical Tokens 56px header recipe. Used by the Ready
   * chrome (`TopBar` crumbs mode).
   */
  tall?: boolean
}

/**
 * The openvoid wordmark — small mark + lowercase "openvoid". Mirrors
 * the wireframe's WFLogo shape (a square with a hollow circle inside),
 * sized so it sits cleanly in the toolbar.
 */
export function Logo() {
  return ({ size = 13, tall = false }: LogoProps) => {
    const wordSize = tall ? 15 : size
    const mark = tall ? 22 : size + 3
    const inner = mark * 0.42

    return (
      <div class="wf-row" mix={css({ gap: '7px' })}>
        <div
          mix={css({
            width: `${mark}px`,
            height: `${mark}px`,
            borderRadius: tall ? '6px' : '4px',
            background: 'var(--wf-fg)',
            display: 'grid',
            placeItems: 'center',
          })}
        >
          <div
            mix={css({
              width: `${inner}px`,
              height: `${inner}px`,
              borderRadius: '50%',
              border: '1.5px solid var(--wf-bg)',
            })}
          />
        </div>
        <span mix={css({ fontWeight: 600, fontSize: `${wordSize}px`, letterSpacing: '-0.01em' })}>
          openvoid
        </span>
      </div>
    )
  }
}
