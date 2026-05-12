import type { RemixNode } from 'remix/ui'

export interface DocumentProps {
  title?: string
  children?: RemixNode
}

/**
 * The HTML shell. Loads CSS in CUBE-canonical cascade order:
 *
 *   1. utopia.css            — substrate (Utopia fluid type/space scales)
 *   2. tokens.css            — substrate (OpenVoid semantic tokens + wf-* aliases)
 *   3. global.css            — reset / globals
 *   4. layout-primitives/*.css — CUBE Composition layer (Every Layout
 *                              primitives: stack, cluster, grid, …).
 *                              One file per primitive.
 *   5. blocks/*.css          — CUBE Block layer, one file per component
 *   6. compositions/*.css    — OpenVoid composition tier (assemblies of
 *                              blocks: App Shell, Card Shell, Composer, …).
 *                              Loaded after blocks so a composition can
 *                              override a block default without `!important`.
 *   7. exceptions.css        — CUBE Exception layer (data-attribute variants)
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
 * @link https://every-layout.dev/
 * @link https://utopia.fyi/
 */
const LAYOUT_PRIMITIVE_FILES = [
  'box',
  'center',
  'cluster',
  'cover',
  'flow',
  'frame',
  'grid',
  'reel',
  'sidebar',
  'stack',
  'switcher',
] as const

const BLOCK_FILES = [
  'alt',
  'animations',
  'app-icon',
  'button',
  'dot',
  'eyebrow',
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
  'provisioning-card',
  'split-tip',
  'stage',
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
        {LAYOUT_PRIMITIVE_FILES.map((name) => (
          <link key={name} rel="stylesheet" href={`/styles/layout-primitives/${name}.css`} />
        ))}
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
