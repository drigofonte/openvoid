import type { RemixNode } from 'remix/ui'

export interface DocumentProps {
  title?: string
  children?: RemixNode
}

/**
 * The HTML shell. Loads CSS through six `<link>` tags in
 * CUBE-canonical cascade order:
 *
 *   1. utopia.css      — substrate (Utopia fluid type/space scales)
 *   2. tokens.css      — substrate (OpenVoid semantic tokens + wf-* aliases)
 *   3. base.css        — reset / globals
 *   4. composition.css — CUBE Composition layer (Every Layout primitives)
 *   5. blocks.css      — CUBE Block layer (component classes + animations)
 *   6. exceptions.css  — CUBE Exception layer (data-attribute variants)
 *
 * File-import order is the cascade-control mechanism (no
 * `@layer` directives required) — see Andy Bell's CUBE
 * boilerplate convention. All six files are served by the
 * `staticFiles` middleware in `app/router.ts`.
 *
 * @link https://cube.fyi/
 * @link https://utopia.fyi/
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
        <link rel="stylesheet" href="/styles/utopia.css" />
        <link rel="stylesheet" href="/styles/tokens.css" />
        <link rel="stylesheet" href="/styles/base.css" />
        <link rel="stylesheet" href="/styles/composition.css" />
        <link rel="stylesheet" href="/styles/blocks.css" />
        <link rel="stylesheet" href="/styles/exceptions.css" />
        <script type="module" src="/_rmx/app/assets/run.ts" />
      </head>
      <body>{children}</body>
    </html>
  )
}
