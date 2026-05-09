import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Eyebrow } from '../../../ui/eyebrow.tsx'

/**
 * Failed view — composed from primitives (no dedicated wireframe).
 *
 * Renders when the Session API reports `status: Failed`. If the
 * (forward-compat) `failureReason.message` is present, it's shown
 * verbatim under the eyebrow; otherwise a generic copy.
 *
 * No retry CTA — the user must start a new session, which gives
 * the agent a fresh ULID and avoids re-using a known-broken Pod.
 */

export interface FailedProps {
  sessionId: string
  reason?: string
}

export function Failed() {
  return ({ sessionId, reason }: FailedProps) => (
    <Card padding="32px">
      <div class="wf-col" mix={css({ gap: '20px' })}>
        <div class="wf-col" mix={css({ gap: '6px' })}>
          <Eyebrow tone="danger">Provisioning failed</Eyebrow>
          <h1 class="wf-h1" tabindex={-1}>Couldn't bring up the session</h1>
          <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
            {reason
              ? reason
              : "Something went wrong while spinning up your dev environment. Try again, or check the agent's logs if the problem repeats."}
          </p>
        </div>

        <p class="wf-faint" mix={css({ fontSize: '12.5px', margin: 0 })}>
          <span class="wf-mono">{sessionId}</span>
        </p>

        <div class="wf-row" mix={css({ gap: '12px', justifyContent: 'flex-end' })}>
          <a class="wf-btn wf-btn-pri" href="/" mix={css({ textDecoration: 'none' })}>
            Back to start
          </a>
        </div>
      </div>
    </Card>
  )
}
