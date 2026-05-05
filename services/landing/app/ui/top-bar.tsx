import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'
import { Logo } from './logo.tsx'

export interface TopBarProps {
  url?: string
  right?: RemixNode
}

/**
 * Browser-chrome-styled toolbar with the openvoid wordmark, an
 * optional URL slug, and an optional right-aligned slot. The wireframes
 * show this on every screen; v1 uses it as decorative chrome (no
 * navigation behind the URL).
 */
export function TopBar() {
  return ({ url = 'openvoid.dev', right }: TopBarProps) => (
    <div class="wf-toolbar">
      <Logo />
      <div mix={css({ width: '1px', height: '18px', background: 'var(--wf-line)', margin: '0 4px' })} />
      <div class="wf-row" mix={css({ gap: '6px' })}>
        <span class="wf-muted" mix={css({ fontSize: '12.5px' })}>maria</span>
        <span class="wf-faint">/</span>
        <span mix={css({ fontSize: '12.5px', fontWeight: 500 })}>{url}</span>
      </div>
      <div class="wf-spacer" />
      {right}
    </div>
  )
}
