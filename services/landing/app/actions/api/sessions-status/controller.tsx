import type { Controller } from 'remix/fetch-router'

import type { routes } from '../../../routes.ts'
import { ApiError, getSessionWithRetry } from '../../../utils/api.ts'
import { deriveView } from '../../../utils/derive.ts'
import { gateOnIngressReadiness } from '../../../utils/ingress.ts'

/**
 * JSON status resource consumed by the StatusPoller clientEntry.
 *
 * Returns the same view-derivation the page controller runs (full
 * `getSessionWithRetry → deriveView → gateOnIngressReadiness`
 * pipeline) so the poller's "did the state change?" comparison
 * accounts for ingress-readiness flips, not just raw API status.
 *
 * Shape is intentionally narrow: just what the poller needs to
 * decide whether to navigate. Browser-side reads `kind`,
 * `pendingPhase`, and the URLs; everything else is for debugging.
 */

const RETRY_OPTIONS = { retries: 3, backoffMs: 200 } as const

import type { PendingPhase } from '../../../utils/derive.ts'

export interface StatusResponse {
  kind: 'provisioning' | 'ready' | 'stopping' | 'done' | 'failed' | 'not_found'
  pendingPhase?: PendingPhase | null
  activeStep?: number | null
  agentUrl?: string | null
  previewUrl?: string | null
  reason?: string | null
}

function jsonResponse(body: StatusResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Aggressive polling cadence (1s/5s/10s) — never let an
      // intermediary cache a status response. Stale state would
      // make the StatusPoller's signature comparison miss real
      // transitions, leaving the user on a frozen Provisioning view.
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  })
}

export default {
  actions: {
    async sessionsStatus({ params }) {
      const id = params.id

      try {
        const session = await getSessionWithRetry(id, RETRY_OPTIONS)
        const baseView = deriveView(session)
        const view = await gateOnIngressReadiness(baseView)

        switch (view.kind) {
          case 'provisioning':
            return jsonResponse({
              kind: 'provisioning',
              pendingPhase: view.pendingPhase,
              activeStep: view.activeStep,
            })
          case 'ready':
            return jsonResponse({
              kind: 'ready',
              agentUrl: view.agentUrl,
              previewUrl: view.previewUrl,
            })
          case 'stopping':
            return jsonResponse({ kind: 'stopping' })
          case 'done':
            return jsonResponse({ kind: 'done' })
          case 'failed':
            return jsonResponse({ kind: 'failed', reason: view.reason ?? null })
          default: {
            const exhaustive: never = view
            void exhaustive
            throw new Error('sessionsStatus: unknown view kind')
          }
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return jsonResponse({ kind: 'not_found' }, 404)
        }
        throw error
      }
    },
  },
} satisfies Controller<typeof routes.api>
