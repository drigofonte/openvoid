import type { RemixNode } from 'remix/ui'

export interface DocumentProps {
  title?: string
  children?: RemixNode
}

/**
 * The HTML shell. Loads CSS in CUBE-canonical cascade order:
 *
 *   1. utopia.css       — substrate (Utopia fluid type/space scales)
 *   2. tokens.css       — substrate (OpenVoid semantic tokens + wf-* aliases)
 *   3. global.css       — reset / globals
 *   4. composition.css  — CUBE Composition layer (Every Layout primitives)
 *   5. blocks/*.css     — CUBE Block layer, one file per component
 *   6. compositions/*.css — OpenVoid composition tier (assemblies of blocks:
 *                         Composer, Cards, Connector, etc.). Loaded after
 *                         blocks so a composition can override a block
 *                         default without `!important`. NOT the same as
 *                         the singular `composition.css` above.
 *   7. exceptions.css   — CUBE Exception layer (data-attribute variants)
 *
 * File-import order is the cascade-control mechanism (no
 * `@layer` directives required) — see Andy Bell's CUBE
 * boilerplate convention. Every file is served by the
 * `staticFiles` middleware in `app/router.ts`.
 *
 * The block files are listed alphabetically except `focus-ring.css`,
 * which loads last so its `:focus-visible` composite wins regardless
 * of which component file defined the underlying selector.
 *
 * @link https://cube.fyi/
 * @link https://utopia.fyi/
 */
const BLOCK_FILES = [
  'alt',
  'animations',
  'app-icon',
  'button',
  'dot',
  'field',
  'icon-mark',
  'kbd',
  'layout',
  'pill',
  'progress',
  'skeleton',
  'spinner',
  'surface',
  'typography',
  'visually-hidden',
  // focus-ring is intentionally last — it depends on selectors
  // declared in many of the files above.
  'focus-ring',
] as const

const COMPOSITION_FILES = [
  'app-shell',
  'card-shell',
  'composer',
  'connector',
  'split-tip',
  'suggestion',
  'url-row',
] as const

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
        <link rel="stylesheet" href="/styles/global.css" />
        <link rel="stylesheet" href="/styles/composition.css" />
        {BLOCK_FILES.map((name) => (
          <link key={name} rel="stylesheet" href={`/styles/blocks/${name}.css`} />
        ))}
        {COMPOSITION_FILES.map((name) => (
          <link key={name} rel="stylesheet" href={`/styles/compositions/${name}.css`} />
        ))}
        <link rel="stylesheet" href="/styles/exceptions.css" />
        <script type="module" src="/_rmx/app/assets/run.ts" />
      </head>
      <body class="app-shell">{children}</body>
    </html>
  )
}
