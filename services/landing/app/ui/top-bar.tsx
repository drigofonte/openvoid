import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'
import { Logo } from './logo.tsx'

export interface TopBarProps {
  /**
   * Decorative path shown after `openvoid.dev` in the URL slug.
   * Defaults to empty (just `openvoid.dev`).
   */
  path?: string
  /**
   * Optional right-aligned slot — e.g. a Cancel link, an Avatar, or
   * a status pill. The wireframes use this to vary chrome across
   * routes (Create → Cancel, Provisioning → Avatar, Ready → status
   * pill + Avatar).
   */
  right?: RemixNode
}

/**
 * Browser-chrome-styled toolbar with the openvoid wordmark, a
 * decorative URL slug (`maria / openvoid.dev<path>`), and a right-
 * aligned slot. v1 doesn't navigate behind any of this — it's
 * decorative chrome matching the wireframe canvas.
 */
export function TopBar() {
  return ({ path = '', right }: TopBarProps) => (
    <header class="wf-toolbar">
      <Logo />
      <div mix={css({ width: '1px', height: '18px', background: 'var(--wf-line)', margin: '0 4px' })} />
      <div class="wf-row" mix={css({ gap: '6px' })}>
        <span class="wf-muted" mix={css({ fontSize: '12.5px' })}>maria</span>
        <span class="wf-faint">/</span>
        <span mix={css({ fontSize: '12.5px', fontWeight: 500 })}>openvoid.dev{path}</span>
      </div>
      <div class="wf-spacer" />
      {right}
    </header>
  )
}
