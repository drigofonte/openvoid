import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'
import { Document } from './document.tsx'
import { TopBar } from './top-bar.tsx'

export interface LayoutProps {
  title?: string
  /**
   * Decorative path appended to `openvoid.dev` in the top-bar URL.
   * E.g. `/new` on Create, `/sessions/<sid>` on session pages.
   */
  topBarPath?: string
  /** Right-aligned content for the top bar. */
  topBarRight?: RemixNode
  children?: RemixNode
}

/**
 * Wraps a page in the Document shell, adds the top bar, and renders
 * the page content inside a centered max-width column matching the
 * wireframe canvas's per-screen padding.
 */
export function Layout() {
  return ({ title, topBarPath, topBarRight, children }: LayoutProps) => (
    <Document title={title}>
      <TopBar path={topBarPath} right={topBarRight} />
      <main mix={css({ maxWidth: '960px', margin: '0 auto', padding: '40px 24px 48px' })}>
        {children}
      </main>
    </Document>
  )
}
