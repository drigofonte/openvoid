import type { components } from '@openvoid/protocol'
import type { Controller } from 'remix/fetch-router'
import { redirect } from 'remix/response/redirect'

import type { routes } from '../../routes.ts'
import { ApiError, deleteSession, getSession, getSessionWithRetry } from '../../utils/api.ts'
import { deriveView } from '../../utils/derive.ts'
import { gateOnIngressReadiness } from '../../utils/ingress.ts'
import { render } from '../../render.tsx'
import { SessionNotFoundPage, SessionPage } from './page.tsx'

/**
 * Sessions controller — `/sessions/:id` show + stop/cancel.
 *
 * `show` (GET) refetches the session, derives the view, runs the
 * ingress-readiness probe, and renders the right state component.
 * Retries on 404 (3× / 200ms) defend the read-after-POST window;
 * after exhaustion we render NotFound with status 404.
 *
 * `stop` is a single POST endpoint that dispatches by `intent`
 * form field — closed union of `stop` | `cancel`. Unknown / missing
 * intent returns 400 (no destructive default).
 *
 *   - `intent=stop`: fetch the pre-delete session for repo +
 *     branch, DELETE upstream, redirect to `/?done=...` so the
 *     home page renders the Done banner. If the GET failed (or
 *     the session lacks repo/branch), redirect to `/` without a
 *     done param — the home page renders cleanly without a
 *     half-broken banner.
 *   - `intent=cancel`: best-effort DELETE (swallow all errors),
 *     redirect to `/`. Cancel is cleanup, not a user-facing
 *     operation; the user has already moved on.
 *
 * Stop failures (503 etc.) re-render the page with an inline error
 * banner above the current view so the user sees what went wrong
 * and can retry. The status code is the upstream's, clamped to a
 * reasonable HTTP range.
 *
 * The `clientEntry`-driven polling Frame + confirm-dialog overlay
 * + cadence-aware reload land in Unit 4b. For now, the user
 * refreshes manually to advance state.
 */

type Session = components['schemas']['Session']

const RETRY_OPTIONS = { retries: 3, backoffMs: 200 } as const

type Intent = 'stop' | 'cancel'
const INTENTS: readonly Intent[] = ['stop', 'cancel']

function parseIntent(value: FormDataEntryValue | null): Intent | null {
  if (typeof value !== 'string') return null
  return INTENTS.includes(value as Intent) ? (value as Intent) : null
}

export default {
  actions: {
    async show({ params, url }) {
      const id = params.id
      const confirmStop = url.searchParams.get('confirm') === 'stop'

      let session: Session
      try {
        session = await getSessionWithRetry(id, RETRY_OPTIONS)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return render(<SessionNotFoundPage sessionId={id} />, { status: 404 })
        }
        throw error
      }

      const baseView = deriveView(session)
      const view = await gateOnIngressReadiness(baseView)

      return render(<SessionPage view={view} confirmStop={confirmStop} />)
    },

    async stop({ get, params }) {
      const id = params.id
      const intent = parseIntent(get(FormData).get('intent'))

      if (intent === null) {
        return new Response('intent must be `stop` or `cancel`', { status: 400 })
      }

      if (intent === 'cancel') {
        // Best-effort cleanup; never block the user on a cancel.
        await deleteSession(id).catch(() => undefined)
        return redirect('/')
      }

      // intent === 'stop': fetch repo/branch *before* DELETE so the
      // redirect target carries them through to the home banner.
      // Narrow the catch to 404 (already-gone) so transient 5xx
      // doesn't silently swallow context.
      const session = await getSession(id).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      })

      try {
        await deleteSession(id)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // Already gone — proceed to home without a Done banner
          // since we may not have repo/branch context.
          return redirect(doneHref(id, session))
        }
        if (error instanceof ApiError && session) {
          // Surface the failure inline. Re-derive the view so the
          // page renders with the same shape, then thread the
          // error through to the SessionPage banner.
          const status = clampUpstreamStatus(error.status)
          const baseView = deriveView(session)
          const view = await gateOnIngressReadiness(baseView)
          return render(
            <SessionPage
              view={view}
              confirmStop={false}
              actionError={{ message: error.message, code: error.code }}
            />,
            { status },
          )
        }
        throw error
      }

      return redirect(doneHref(id, session))
    },
  },
} satisfies Controller<typeof routes.sessions>

function clampUpstreamStatus(status: number): number {
  return status >= 400 && status < 600 ? status : 502
}

/**
 * Build the home redirect after a successful stop. If we have repo
 * + branch from the pre-delete session, emit a `?done=...` URL so
 * the home page renders the Done banner. Otherwise redirect to `/`
 * — the banner without a working GitHub link would be misleading.
 */
function doneHref(sessionId: string, session: Session | null): string {
  const repo = session?.repo
  const branch = session?.branch
  if (!repo || !branch) return '/'
  const params = new URLSearchParams({ done: sessionId, repo, branch })
  return `/?${params.toString()}`
}
