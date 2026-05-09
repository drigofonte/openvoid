import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { RemixNode } from 'remix/ui'

export interface DocumentProps {
  title?: string
  children?: RemixNode
}

/**
 * Composition-layer CSS (Every Layout primitives — `.stack`, `.cluster`,
 * `.cover`, etc.) is co-located with the React components in
 * `app/ui/layout/composition.css`. The static-files middleware only
 * serves from `public/`, and the asset server compiles JS/TS, so the
 * file is unreachable from the browser unless we ship it ourselves.
 * Reading it once at module load and inlining it in `<head>` keeps the
 * file co-located with its components, eliminates a render-blocking
 * round-trip, and avoids a new route. ~4 KB on every HTML response.
 *
 * Revisit triggers (in any of these cases, switch to a small GET route
 * at `/styles/composition.css` or move/symlink into `public/styles/`):
 *   - Total inlined CSS exceeds ~10–15 KB.
 *   - A second or third co-located CSS file appears under `app/ui/`.
 *   - A real CSS build step lands.
 *
 * Fails fast at boot if the file is missing — surfaces loudly during
 * test setup or `pnpm dev`, never as a silent runtime regression.
 */
const COMPOSITION_CSS = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'layout/composition.css'),
  'utf-8',
)

/**
 * The HTML shell. Loads design tokens (`/styles/theme.css`) and resets
 * (`/styles/base.css`) which are served as static assets by the
 * `staticFiles` middleware in `app/router.ts`. Fonts (Inter,
 * JetBrains Mono) come from Google Fonts to match the wireframe
 * canvas's loading. The composition layer (`composition.css`) is
 * inlined — see the constant above for the rationale.
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
        <style>{COMPOSITION_CSS}</style>
        <script type="module" src="/_rmx/app/assets/run.ts" />
      </head>
      <body>{children}</body>
    </html>
  )
}
