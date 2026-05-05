import { route, get, post } from 'remix/fetch-router/routes'

/**
 * The openvoid landing's route table.
 *
 * - `/` — home (Create screen + optional Done banner via `?done=`).
 * - `/sessions/:id` — Provisioning / Ready / Kill flow / Failed /
 *   Timeout, all derived from the loader payload (Unit 4).
 * - `/api/sessions/:id/status` — JSON resource consumed by the
 *   `<Frame>` polling region inside `clientEntry`-wrapped components
 *   (Unit 4).
 *
 * Static assets (`/styles/*`, etc.) are served by the `staticFiles`
 * middleware in `app/router.ts` and don't need explicit routes here.
 */
export const routes = route({
  home: route('/', {
    index: get('/'),
    create: post('/'),
  }),
  sessions: route('/sessions/:id', {
    show: get('/'),
    stop: post('/'),
  }),
  api: route('/api', {
    sessionsStatus: get('/sessions/:id/status'),
  }),
})
