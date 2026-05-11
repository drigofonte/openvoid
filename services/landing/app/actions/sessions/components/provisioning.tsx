import { css } from 'remix/ui'

import { Kicker } from '../../../ui/kicker.tsx'
import { CancelButton } from '../client/cancel-button.tsx'
import { TipCarousel } from '../client/tip-carousel.tsx'

/**
 * Provisioning view (wireframe variant 03-A).
 *
 * Center-aligned single column. The hero is a rounded-square app
 * icon with a spinner inside, then SPINNING UP eyebrow, the
 * session ID in monospace, a one-line subhead, the tip carousel,
 * and a Cancel link.
 *
 * Auto-advance is wired via the StatusPoller mounted in
 * SessionPage; users no longer need to refresh manually. The
 * `pendingPhase` prop swaps the subhead copy between the early
 * pending state and the brief "Running but ingress not yet
 * programmed" window.
 */

export interface ProvisioningProps {
  sessionId: string
  pendingPhase?: 'pending' | 'running-pre-ingress'
}

const STATUS_COPY: Record<NonNullable<ProvisioningProps['pendingPhase']>, string> = {
  pending: 'Provisioning a fresh sandbox and warming up the agent. Hang tight.',
  'running-pre-ingress': "Almost ready — programming routes for your agent and preview.",
}

export function Provisioning() {
  return ({ sessionId, pendingPhase }: ProvisioningProps) => {
    const status = pendingPhase ? STATUS_COPY[pendingPhase] : STATUS_COPY['pending']
    return (
      <div
        class="wf-col"
        mix={css({ gap: '32px', alignItems: 'center', textAlign: 'center', padding: '40px 0' })}
      >
        <div class="wf-app-icon" aria-hidden="true">
          <span class="wf-spinner" />
        </div>

        <div class="wf-col" mix={css({ gap: '12px', alignItems: 'center', maxWidth: '520px' })}>
          <Kicker>Spinning up</Kicker>
          <h1
            class="wf-mono"
            tabindex={-1}
            mix={css({ fontSize: '22px', wordBreak: 'break-all' })}
          >
            {sessionId}
          </h1>
          <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
            {status}
          </p>
        </div>

        <TipCarousel />

        <div mix={css({ marginTop: '8px' })}>
          <CancelButton sessionId={sessionId} />
        </div>
      </div>
    )
  }
}
