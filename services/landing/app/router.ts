import { createRouter } from 'remix/fetch-router'
import { logger } from 'remix/logger-middleware'
import { staticFiles } from 'remix/static-middleware'
import { formData } from 'remix/form-data-middleware'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

import { routes } from './routes.ts'
import assetsController from './actions/assets/controller.tsx'
import homeController from './actions/home/controller.tsx'
import sessionsController from './actions/sessions/controller.tsx'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')

/**
 * Build the openvoid landing router.
 *
 * Middleware order matters: `logger` first (so it sees every request
 * including 404s), then `staticFiles` (assets short-circuit before
 * controllers), then `formData` (controllers see parsed form bodies).
 *
 * Unit 1 ships only the home route. Unit 3 wires up the create
 * action; Unit 4 adds the sessions controller + the api status
 * resource controller.
 */
export function createLandingRouter() {
  const middleware = [
    logger(),
    staticFiles(publicDir),
    formData(),
  ]

  const router = createRouter({ middleware })

  router.map(routes.home, homeController)
  router.map(routes.sessions, sessionsController)
  router.map(routes.assets, assetsController)

  return router
}
