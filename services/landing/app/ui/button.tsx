import type { RemixNode } from 'remix/ui'

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'danger' | 'default'

export interface ButtonProps {
  variant?: ButtonVariant
  type?: 'button' | 'submit' | 'reset'
  name?: string
  value?: string
  disabled?: boolean
  children?: RemixNode
}

/**
 * Action primitive — variants map onto `wireframe-primitives.jsx`'s
 * `wf-btn-pri` (black-on-white), `wf-btn-acc` (warm orange),
 * `wf-btn-ghost` (transparent), `wf-btn-danger` (red text on white).
 * `default` is the plain outlined button.
 *
 * Static-only — interactive behavior (pending state, click handlers)
 * is added in later units via `clientEntry`-wrapped buttons.
 */
export function Button() {
  return ({ variant = 'default', type = 'button', name, value, disabled, children }: ButtonProps) => {
    let cls = 'wf-btn'
    if (variant === 'primary') cls += ' wf-btn-pri'
    else if (variant === 'accent') cls += ' wf-btn-acc'
    else if (variant === 'ghost') cls += ' wf-btn-ghost'
    else if (variant === 'danger') cls += ' wf-btn-danger'

    return (
      <button class={cls} type={type} name={name} value={value} disabled={disabled || undefined}>
        {children}
      </button>
    )
  }
}
