import type { RemixNode } from 'remix/ui'
import { renderToStream } from 'remix/ui/server'
import { createHtmlResponse } from 'remix/response/html'

/**
 * Convenience wrapper around `renderToStream` that returns an
 * `HTMLResponse`. Unit 1 uses the no-frame variant (no resolveFrame /
 * resolveClientEntry callbacks). Unit 4 extends this when polling
 * `<Frame>` regions and `clientEntry`-wrapped interactive components
 * land — at that point the helper grows resolvers and probably moves
 * to consume the request from `remix/async-context-middleware` like
 * the bookstore demo's `render.tsx` does.
 */
export function render(node: RemixNode, init?: ResponseInit): Response {
  let stream = renderToStream(node, {
    onError(error) {
      console.error(error)
    },
  })
  return createHtmlResponse(stream, init)
}
