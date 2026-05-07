import type { RemixNode } from 'remix/ui'
import { renderToStream } from 'remix/ui/server'
import { createHtmlResponse } from 'remix/response/html'

import { resolveAssetHref } from './assets-server.ts'

/**
 * Convenience wrapper around `renderToStream` that returns an
 * `HTMLResponse` and wires up `clientEntry` resolution.
 *
 * `resolveClientEntry` maps each `clientEntry(import.meta.url, …)`
 * marker the renderer encounters into the public asset URL the
 * browser should dynamic-import. Without this, the SSR output
 * would carry placeholder markers that `run()` cannot resolve and
 * hydration would silently fail.
 *
 * The export-name resolution is small but necessary: a
 * `clientEntry` may be the default export (use the component's
 * function name) or a named export with `#ExportName` baked into
 * the entry id. We honour the suffix when present and fall back
 * to the function name otherwise.
 */
export function render(node: RemixNode, init?: ResponseInit): Response {
  const stream = renderToStream(node, {
    async resolveClientEntry(entryId, component) {
      // `||` (not `??`) so `'file://…#'` falls through to the
      // function name instead of becoming the empty string.
      const exportName = (entryId.split('#')[1] || component.name) ?? ''
      if (!exportName) {
        throw new Error(`Cannot resolve client entry export name for ${entryId}`)
      }
      const href = await resolveAssetHref(entryId)
      return { href, exportName }
    },
    onError(error) {
      console.error(error)
    },
  })
  return createHtmlResponse(stream, init)
}
