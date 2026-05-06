import type { components } from '@openvoid/protocol'

/**
 * Pure session → view derivation. Lifts the gating logic from the
 * old `LandingState.onSession` (Phase 7) into a function the
 * `/sessions/:id` controller calls per render.
 *
 * Status-gated URL contract (R3): we promote to `ready` only when
 * `status === "Running"` AND both `agentUrl` and `previewUrl` are
 * populated. The Session API may briefly return Running before the
 * per-session Ingress is programmed; treat that as still
 * provisioning (the controller's ingress-readiness probe in Unit 4
 * may downgrade further).
 *
 * `failureReason` is a forward-compat hook: the v1 protocol does
 * not declare it, so today the controller always passes a real
 * `Session` and the Failed view's `reason` is `undefined`. The
 * field is here so the future protocol bump that adds it is a
 * one-line change in `@openvoid/protocol`, not a churn through
 * derive + the page component.
 */

type Session = components['schemas']['Session']
type SessionPhase = components['schemas']['SessionPhase']

export interface DeriveInput extends Session {
  failureReason?: { message?: string }
}

export type View =
  | { kind: 'provisioning'; sessionId: string; status: SessionPhase; pendingPhase?: PendingPhase }
  | { kind: 'ready'; sessionId: string; agentUrl: string; previewUrl: string }
  | { kind: 'stopping'; sessionId: string }
  | { kind: 'done'; sessionId: string }
  | { kind: 'failed'; sessionId: string; reason?: string }

export type PendingPhase = 'pending' | 'running-pre-ingress'

export function deriveView(session: DeriveInput): View {
  const sessionId = session.sessionId
  switch (session.status) {
    case 'Pending':
      return { kind: 'provisioning', sessionId, status: 'Pending', pendingPhase: 'pending' }
    case 'Running': {
      if (session.agentUrl && session.previewUrl) {
        return {
          kind: 'ready',
          sessionId,
          agentUrl: session.agentUrl,
          previewUrl: session.previewUrl,
        }
      }
      return {
        kind: 'provisioning',
        sessionId,
        status: 'Running',
        pendingPhase: 'running-pre-ingress',
      }
    }
    case 'Stopping':
      return { kind: 'stopping', sessionId }
    case 'Stopped':
      return { kind: 'done', sessionId }
    case 'Failed':
      return { kind: 'failed', sessionId, reason: session.failureReason?.message }
    default: {
      const exhaustive: never = session.status
      throw new Error(`deriveView: unknown SessionPhase: ${String(exhaustive)}`)
    }
  }
}
