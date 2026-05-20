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
 * U9: the server now sends a real `pendingPhase` discriminator when
 * `status === "Pending"` (`provisioning | seeding-scaffold |
 * installing-deps | awaiting-dev-server`) and a `SessionError`
 * when `status === "Failed"`. derive.ts reads the server signal
 * verbatim and contributes a stable `activeStep` integer (0-4) so
 * the storyboard can advance on real boot signals.
 */

type Session = components['schemas']['Session']
type SessionPhase = components['schemas']['SessionPhase']

export type PendingPhase = components['schemas']['PendingPhase']

export interface DeriveInput extends Session {
  /**
   * Forward-compat hook for callers still using the legacy shape.
   * The current protocol carries failure detail in `Session.error`;
   * `failureReason.message` is honoured as a fallback so any test
   * fixtures or in-flight migrations keep working without churn.
   */
  failureReason?: { message?: string }
}

export type View =
  | {
      kind: 'provisioning'
      sessionId: string
      status: SessionPhase
      pendingPhase: PendingPhase
      /** 0..4 — drives the storyboard's active-step indicator. Derived
       *  from `pendingPhase` so the same phase string never produces
       *  two different active steps. */
      activeStep: number
      /** ISO timestamp from the Session record; drives the storyboard's
       *  stable-timestamp anchor for elapsed-time computation. May be
       *  undefined for older session records — the storyboard tolerates
       *  this by no-oping rather than animating against NaN. */
      sessionCreatedAt?: string
    }
  | { kind: 'ready'; sessionId: string; agentUrl: string; previewUrl: string }
  | { kind: 'stopping'; sessionId: string }
  | { kind: 'done'; sessionId: string }
  | { kind: 'failed'; sessionId: string; reason?: string }

const ACTIVE_STEP: Record<PendingPhase, number> = {
  provisioning: 0,
  'seeding-scaffold': 1,
  'installing-deps': 2,
  'awaiting-dev-server': 3,
  'running-pre-ingress': 4,
}

export function activeStepFor(phase: PendingPhase): number {
  return ACTIVE_STEP[phase]
}

export function deriveView(session: DeriveInput): View {
  const sessionId = session.sessionId
  switch (session.status) {
    case 'Pending': {
      // Server emits a real phase when status === Pending; fall back
      // to `provisioning` if a pre-U9 server response somehow makes
      // it through.
      const phase: PendingPhase = session.pendingPhase ?? 'provisioning'
      return {
        kind: 'provisioning',
        sessionId,
        status: 'Pending',
        pendingPhase: phase,
        activeStep: ACTIVE_STEP[phase],
        sessionCreatedAt: session.createdAt,
      }
    }
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
        activeStep: ACTIVE_STEP['running-pre-ingress'],
        sessionCreatedAt: session.createdAt,
      }
    }
    case 'Stopping':
      return { kind: 'stopping', sessionId }
    case 'Stopped':
      return { kind: 'done', sessionId }
    case 'Failed':
      // Prefer the new protocol field (`session.error.message`); fall
      // back to the legacy `failureReason.message` shape so existing
      // test fixtures keep working through U10's failed-view rewire.
      return {
        kind: 'failed',
        sessionId,
        reason: session.error?.message ?? session.failureReason?.message,
      }
    default: {
      const exhaustive: never = session.status
      throw new Error(`deriveView: unknown SessionPhase: ${String(exhaustive)}`)
    }
  }
}
