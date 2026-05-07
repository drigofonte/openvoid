import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Eyebrow } from '../../../ui/eyebrow.tsx'
import { CancelButton } from '../client/cancel-button.tsx'

/**
 * Provisioning view (wireframe variant 03-A simplified for v1).
 *
 * Renders a progress card with a heading, a status line keyed off
 * `pendingPhase`, and a Cancel form. Auto-advance is wired via
 * the StatusPoller mounted in SessionPage; users no longer need
 * to refresh manually.
 *
 * The Cancel form posts `intent=cancel` to the same route — the
 * controller DELETEs the session and redirects to `/` with no Done
 * banner (nothing was saved, so no `feat/<sid>` link to surface).
 * The clientEntry CancelButton wraps the form with a "Cancelling…"
 * pending state so the user sees feedback during the brief
 * navigation window.
 */

export interface ProvisioningProps {
  sessionId: string
  pendingPhase?: 'pending' | 'running-pre-ingress'
}

const STATUS_COPY: Record<NonNullable<ProvisioningProps['pendingPhase']>, string> = {
  pending: 'Starting a private dev environment for your repo…',
  'running-pre-ingress': 'Almost ready — programming routes for your agent and preview…',
}

export function Provisioning() {
  return ({ sessionId, pendingPhase }: ProvisioningProps) => {
    const status = pendingPhase ? STATUS_COPY[pendingPhase] : STATUS_COPY['pending']
    return (
      <Card padding="32px">
        <div class="wf-col" mix={css({ gap: '20px' })}>
          <div class="wf-col" mix={css({ gap: '6px' })}>
            <Eyebrow>Provisioning · Step 1 of 1</Eyebrow>
            <h1 class="wf-h1" tabindex={-1}>Spinning up your session</h1>
            <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
              {status}
            </p>
          </div>

          <div class="wf-progress-track" mix={css({ width: '100%' })}>
            <div
              class="wf-progress-fill wf-pulse"
              mix={css({ width: pendingPhase === 'running-pre-ingress' ? '85%' : '40%' })}
            />
          </div>

          <p class="wf-faint" mix={css({ fontSize: '12.5px', margin: 0 })}>
            <span class="wf-mono">{sessionId}</span>
          </p>

          <div class="wf-row" mix={css({ gap: '8px', justifyContent: 'flex-end' })}>
            <CancelButton sessionId={sessionId} />
          </div>
        </div>
      </Card>
    )
  }
}
