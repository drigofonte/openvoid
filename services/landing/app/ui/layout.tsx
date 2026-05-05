import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'
import { Document } from './document.tsx'
import { TopBar } from './top-bar.tsx'

export interface LayoutProps {
  title?: string
  url?: string
  children?: RemixNode
}

/**
 * Wraps a page in the Document shell, adds the top bar, and renders
 * the page content inside a centered max-width column matching the
 * wireframe canvas's per-screen padding.
 */
export function Layout() {
  return ({ title, url, children }: LayoutProps) => (
    <Document title={title}>
      <TopBar url={url} />
      <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px 48px' })}>
        {children}
      </main>
    </Document>
  )
}
