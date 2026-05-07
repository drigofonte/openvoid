import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import { createAssetServer } from 'remix/assets'

/**
 * Module-level asset server singleton. Compiles + serves source
 * `.ts/.tsx` from `app/` at the public `/_rmx/*` namespace so
 * client entries (`clientEntry(import.meta.url, …)` markers and
 * the `app/assets/run.ts` boot script) load straight from source
 * with no separate bundle step.
 *
 * Mounted as a route in `app/router.ts`. Consumed by `render.tsx`
 * via `resolveClientEntry` to map `import.meta.url` → public href.
 *
 * Server-only files are kept off the wire by the `deny` rule:
 * `*.server.*` plus the `actions/`, `middleware/`, `utils/` server
 * code. Only `app/assets/**` and `app/actions/**\/client/**` are
 * safe to ship to a browser.
 */

// Anchor at the monorepo root so the asset server can resolve
// `node_modules/.pnpm/<store>/...` — pnpm hoists the actual package
// files to the repo root, and esbuild's import resolution follows
// the symlinks all the way up. With a narrower `services/landing/`
// rootDir, `import { run } from 'remix/ui'` resolves outside the
// allow list and 500s.
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SERVICE_DIR = 'services/landing'

export const ASSET_BASE_PATH = '/_rmx'
export const BOOT_ENTRY_FILE = `${SERVICE_DIR}/app/assets/run.ts`

export const assetServer = createAssetServer({
  basePath: ASSET_BASE_PATH,
  rootDir: ROOT_DIR,
  fileMap: {
    'app/*path': `${SERVICE_DIR}/app/*path`,
    'node_modules/*path': 'node_modules/*path',
  },
  allow: [
    `${SERVICE_DIR}/app/assets/**`,
    `${SERVICE_DIR}/app/**/client/**`,
    'node_modules/**',
  ],
  deny: [`${SERVICE_DIR}/app/**/*.server.*`],
  target: { es: '2022', chrome: '109', safari: '16.4' },
  sourceMaps: process.env.NODE_ENV === 'development' ? 'external' : undefined,
  minify: process.env.NODE_ENV === 'production',
  watch: process.env.NODE_ENV === 'development',
  scripts: {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
  },
})

/**
 * Convert a `clientEntry(import.meta.url, …)` source ID into the
 * filesystem path the asset server expects. The `entryId` is a
 * `file://` URL pointing at the source `.tsx` on disk; strip the
 * `rootDir` prefix to get the relative path.
 *
 * If the entry id has a `#ExportName` suffix (Remix 3 supports
 * choosing a non-default export), drop it — `getHref` only deals
 * with the file portion.
 */
export async function resolveAssetHref(entryId: string): Promise<string> {
  const fileSegment = entryId.split('#')[0]!
  const filePath = fileSegment.startsWith('file://')
    ? fileURLToPath(fileSegment)
    : fileSegment
  const relative = path.relative(ROOT_DIR, filePath)
  return assetServer.getHref(relative)
}
