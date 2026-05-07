import type { RemixNode } from 'remix/ui'

export interface DocumentProps {
  title?: string
  children?: RemixNode
}

/**
 * The HTML shell. Loads design tokens (`/styles/theme.css`) and resets
 * (`/styles/base.css`) which are served as static assets by the
 * `staticFiles` middleware in `app/router.ts`. Fonts (Inter,
 * JetBrains Mono) come from Google Fonts to match the wireframe
 * canvas's loading.
 */
export function Document() {
  return ({ title = 'openvoid', children }: DocumentProps) => (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        <link rel="stylesheet" href="/styles/base.css" />
        <link rel="stylesheet" href="/styles/theme.css" />
        <script type="module" src="/_rmx/app/assets/run.ts" />
      </head>
      <body>{children}</body>
    </html>
  )
}
