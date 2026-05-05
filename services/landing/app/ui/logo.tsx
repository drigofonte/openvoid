import { css } from 'remix/ui'

export interface LogoProps {
  size?: number
}

/**
 * The openvoid wordmark — small mark + lowercase "openvoid". Mirrors
 * the wireframe's WFLogo shape (a square with a hollow circle inside),
 * sized so it sits cleanly in the toolbar.
 */
export function Logo() {
  return ({ size = 13 }: LogoProps) => {
    let mark = size + 3
    let inner = mark * 0.42

    return (
      <div class="wf-row" mix={css({ gap: '7px' })}>
        <div
          mix={css({
            width: `${mark}px`,
            height: `${mark}px`,
            borderRadius: '4px',
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
        <span mix={css({ fontWeight: 600, fontSize: `${size}px`, letterSpacing: '-0.01em' })}>
          openvoid
        </span>
      </div>
    )
  }
}
