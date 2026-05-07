import { clientEntry, navigate, type Handle } from 'remix/ui'

import { pollCadenceMs } from '../../../utils/poll.ts'
import type { StatusResponse } from '../../api/sessions-status/controller.tsx'

/**
 * StatusPoller — invisible clientEntry that polls
 * `/api/sessions/:id/status` and triggers an SPA navigation
 * (`history: 'replace'`) whenever the session's view-state
 * signature changes. The page re-renders fresh from the server
 * with the new state.
 *
 * Cadence comes from `pollCadenceMs(elapsed)`: 1s for the first
 * 30s, 5s after, 10s after 90s. Cleanup via `handle.signal` —
 * when the component disconnects (page navigates away or
 * unmounts), the in-flight setTimeout chain stops.
 *
 * 404-on-poll triggers an immediate navigation: a session that
 * disappears out-of-band (Operator GC, admin delete, expired
 * idle-timeout) should land the user on the SessionNotFoundPage
 * the page controller already renders for that case, not leave
 * them staring at a frozen Provisioning view forever.
 *
 * v1 design note: the plan specified `<Frame>`-based polling. We
 * went with JSON poll + SPA navigation instead — see
 * `commit 4ab930e` for full rationale.
 */

function signature(payload: Pick<StatusResponse, 'kind' | 'pendingPhase' | 'agentUrl' | 'previewUrl'>): string {
  return [
    payload.kind,
    payload.pendingPhase ?? '',
    payload.agentUrl ?? '',
    payload.previewUrl ?? '',
  ].join('|')
}

function isStatusResponse(value: unknown): value is StatusResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as { kind: unknown }).kind === 'string'
  )
}

export const StatusPoller = clientEntry(
  import.meta.url,
  function StatusPoller(
    handle: Handle<{
      sessionId: string
      initialKind: StatusResponse['kind']
      initialPendingPhase: string | null
      initialAgentUrl: string | null
      initialPreviewUrl: string | null
    }>,
  ) {
    const start = Date.now()
    // Build the initial signature inline rather than passing
    // through `signature()` — the prop types are intentionally
    // wider than StatusResponse's discriminated union so SSR can
    // pass any string for the initial pendingPhase without TS
    // narrowing complaints.
    let lastSignature = [
      handle.props.initialKind,
      handle.props.initialPendingPhase ?? '',
      handle.props.initialAgentUrl ?? '',
      handle.props.initialPreviewUrl ?? '',
    ].join('|')
    let timer: ReturnType<typeof setTimeout> | undefined

    const refresh = () => {
      navigate(window.location.pathname + window.location.search, {
        history: 'replace',
      })
    }

    const tick = async (): Promise<void> => {
      if (handle.signal.aborted) return
      try {
        const response = await fetch(`/api/sessions/${handle.props.sessionId}/status`, {
          headers: { accept: 'application/json' },
          signal: handle.signal,
          cache: 'no-store',
        })
        if (handle.signal.aborted) return

        if (response.status === 404) {
          // Session disappeared. Refresh so the page controller's
          // own 404-handling renders the SessionNotFoundPage.
          refresh()
          return
        }

        if (response.ok) {
          const raw: unknown = await response.json()
          if (handle.signal.aborted) return
          if (!isStatusResponse(raw)) {
            // Non-conforming body (proxy error page, framework
            // change). Skip this tick and hope the next one
            // recovers; do NOT navigate on garbage.
          } else {
            const sig = signature(raw)
            if (sig !== lastSignature) {
              lastSignature = sig
              refresh()
              return
            }
          }
        }
      } catch {
        if (handle.signal.aborted) return
        // Network error — keep polling. Transient blip shouldn't
        // disrupt the user.
      }
      const elapsed = Date.now() - start
      timer = setTimeout(tick, pollCadenceMs(elapsed))
    }

    handle.signal.addEventListener('abort', () => {
      if (timer) clearTimeout(timer)
    })

    timer = setTimeout(tick, pollCadenceMs(0))

    return () => null
  },
)
