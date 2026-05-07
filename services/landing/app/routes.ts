import { route, get, post } from 'remix/fetch-router/routes'

// The openvoid landing's route table.
//
// - `/`                        home (Create + optional Done banner via ?done=).
// - `/sessions/:id`            Provisioning / Ready / Kill flow / Failed,
//                              all derived from the controller's view derivation.
// - `/api/sessions/:id/status` HTML fragment consumed by the <Frame> polling
//                              region in the SessionPage.
// - `/_rmx/<wild>`             createAssetServer mount, compiles app source on
//                              demand for the browser (boot + clientEntry modules).
//
// Static public assets (e.g. `/styles/...`) are served by the staticFiles
// middleware in app/router.ts.
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
  assets: route('/_rmx', {
    asset: get('/*path'),
  }),
})
