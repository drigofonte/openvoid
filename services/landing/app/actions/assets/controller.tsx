import type { Controller } from 'remix/fetch-router'

import type { routes } from '../../routes.ts'
import { assetServer } from '../../assets-server.ts'

/**
 * Asset route — proxies any `/_rmx/*` GET to the
 * `createAssetServer()` instance defined in `app/assets-server.ts`.
 * The server compiles `.ts/.tsx` on demand and emits browser-
 * compatible JS. Anything outside the configured `allow` list (or
 * matching `deny`) returns 404, so server-only modules cannot leak
 * to the browser even if a path is guessed.
 */

export default {
  actions: {
    async asset({ request }) {
      const response = await assetServer.fetch(request)
      return response ?? new Response('Not Found', { status: 404 })
    },
  },
} satisfies Controller<typeof routes.assets>
