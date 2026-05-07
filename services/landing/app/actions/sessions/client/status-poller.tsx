import { clientEntry, navigate, type Handle } from 'remix/ui'

import { pollCadenceMs } from '../../../utils/poll.ts'

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
 * v1 design note: the plan specified `<Frame>`-based polling. We
 * went with JSON poll + SPA navigation instead. Two reasons:
 * (1) avoids the double-fetch where both the page controller and
 * the Frame's resolveFrame would hit the Session API on first
 * render; (2) matches the framework's own guidance ("Use polling
 * or a small JSON state endpoint when the data changes outside
 * this page" — `references/hydration-frames-navigation.md`). Frame
 * polling can land later if the bandwidth cost of full re-renders
 * matters.
 */

interface StatusPayload {
  kind: string
  pendingPhase?: string | null
  agentUrl?: string | null
  previewUrl?: string | null
  reason?: string | null
}

function signature(payload: Pick<StatusPayload, 'kind' | 'pendingPhase' | 'agentUrl' | 'previewUrl'>): string {
  return [
    payload.kind,
    payload.pendingPhase ?? '',
    payload.agentUrl ?? '',
    payload.previewUrl ?? '',
  ].join('|')
}

export const StatusPoller = clientEntry(
  import.meta.url,
  function StatusPoller(
    handle: Handle<{
      sessionId: string
      initialKind: string
      initialPendingPhase: string | null
      initialAgentUrl: string | null
      initialPreviewUrl: string | null
    }>,
  ) {
    const start = Date.now()
    let lastSignature = signature({
      kind: handle.props.initialKind,
      pendingPhase: handle.props.initialPendingPhase,
      agentUrl: handle.props.initialAgentUrl,
      previewUrl: handle.props.initialPreviewUrl,
    })
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async (): Promise<void> => {
      if (handle.signal.aborted) return
      try {
        const response = await fetch(`/api/sessions/${handle.props.sessionId}/status`, {
          headers: { accept: 'application/json' },
          signal: handle.signal,
        })
        if (handle.signal.aborted) return
        if (response.ok) {
          const payload = (await response.json()) as StatusPayload
          const sig = signature(payload)
          if (sig !== lastSignature) {
            // State changed — replace history with a fresh server-render
            // of the same URL. Returns without scheduling another tick;
            // the navigation will unmount us and remount on the new page.
            lastSignature = sig
            navigate(window.location.pathname + window.location.search, { history: 'replace' })
            return
          }
        }
      } catch (error) {
        if (handle.signal.aborted) return
        // Network error or non-JSON body — keep polling. The page
        // is unchanged; a transient blip shouldn't disrupt the user.
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
