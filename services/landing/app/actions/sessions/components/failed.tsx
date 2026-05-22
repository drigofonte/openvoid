import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Kicker } from '../../../ui/kicker.tsx'

/**
 * Failed view — renders when the Session API reports
 * `status: Failed`. derive.ts maps the server's machine-readable
 * `error.code` to safe user-facing copy via `failedReasonFor` and
 * surfaces a `retryHref` (always `/` in v1 — a new session gets a
 * fresh ULID and avoids re-using a known-broken Pod).
 *
 * `reason` is always present (generic fallback applies when the
 * code is missing or unrecognised), so the component never has to
 * branch on its absence.
 */

export interface FailedProps {
  sessionId: string
  reason: string
  retryHref: string
}

export function Failed() {
  return ({ sessionId, reason, retryHref }: FailedProps) => (
    <Card padding="32px">
      <div class="wf-col" mix={css({ gap: '20px' })}>
        <div class="wf-col" mix={css({ gap: '6px' })}>
          <Kicker tone="danger">That session didn't start</Kicker>
          <h1 tabindex={-1}>Couldn't bring up the session</h1>
          <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
            {reason}
          </p>
        </div>

        <p class="wf-faint" mix={css({ fontSize: '12.5px', margin: 0 })}>
          <span class="wf-mono">{sessionId}</span>
        </p>

        <div class="wf-row" mix={css({ gap: '12px', justifyContent: 'flex-end' })}>
          <a
            class="btn-ghost"
            href="mailto:support@openvoid.dev"
            mix={css({ textDecoration: 'none' })}
          >
            Tell us what happened
          </a>
          <a class="btn-pri" href={retryHref} mix={css({ textDecoration: 'none' })}>
            Start a new session
          </a>
        </div>
      </div>
    </Card>
  )
}
