import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'
import { Document } from './document.tsx'
import { TopBar, type TopBarChrome } from './top-bar.tsx'

export interface LayoutProps {
  title?: string
  /**
   * Discriminated chrome shape forwarded to the TopBar — see
   * `TopBarChrome`. Use `{ mode: 'path', path }` for the
   * decorative URL-slug header (Home, Create, non-Ready session
   * states); use `{ mode: 'crumbs', here, workspace? }` for the
   * 56px breadcrumb chrome (Ready).
   */
  topBarChrome: TopBarChrome
  /** Right-aligned content for the top bar. */
  topBarRight?: RemixNode
  /**
   * Main wrapper kind:
   *
   * - `narrow` (default) — 960px max-width column with per-screen
   *   padding, matching the wireframe canvas shape.
   * - `full` — width 100%, no max-width or padding. The page owns
   *   its own stage layout (used by Ready's Cover).
   */
  mainKind?: 'narrow' | 'full'
  children?: RemixNode
}

/**
 * Wraps a page in the Document shell, adds the top bar, and renders
 * the page content inside `mainKind`'s wrapper.
 */
export function Layout() {
  return ({
    title,
    topBarChrome,
    topBarRight,
    mainKind = 'narrow',
    children,
  }: LayoutProps) => (
    <Document title={title}>
      <TopBar chrome={topBarChrome} right={topBarRight} />
      {mainKind === 'full' ? (
        <main mix={css({ width: '100%' })}>{children}</main>
      ) : (
        <main mix={css({ maxWidth: '960px', margin: '0 auto', padding: '40px 24px 48px' })}>
          {children}
        </main>
      )}
    </Document>
  )
}
