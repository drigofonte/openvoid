import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Eyebrow } from '../../../ui/eyebrow.tsx'

/**
 * Kill-confirm view (wireframe variant 06-A simplified).
 *
 * Reached via `Ready → Stop & save` link to `?confirm=stop`. The
 * SSR-friendly confirm pattern: render this page, two forms — one
 * to commit the destructive action (POST intent=stop), one to
 * back out (GET to `/sessions/:id`, dropping the confirm query).
 *
 * The visual `clientEntry` dialog overlay (06-B style) lands in
 * Unit 4b. The behaviour is the same; only the chrome changes.
 */

export interface KillConfirmProps {
  sessionId: string
}

export function KillConfirm() {
  return ({ sessionId }: KillConfirmProps) => (
    <Card padding="32px">
      <div class="wf-col" mix={css({ gap: '20px' })}>
        <div class="wf-col" mix={css({ gap: '6px' })}>
          <Eyebrow tone="danger">Stop session</Eyebrow>
          <h1 tabindex={-1}>Save your work and shut down?</h1>
          <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
            We'll commit any edits the agent made to a fresh
            <code class="wf-mono"> feat/{sessionId}</code> branch on your repo
            and shut down the dev environment. This usually takes a few
            seconds. The session will not be recoverable.
          </p>
        </div>

        <div
          class="wf-row"
          mix={css({ gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' })}
        >
          <a
            class="wf-btn wf-btn-ghost"
            href={`/sessions/${sessionId}`}
            mix={css({ textDecoration: 'none' })}
          >
            Keep working
          </a>
          <form method="post" action={`/sessions/${sessionId}`}>
            <input type="hidden" name="intent" value="stop" />
            <button type="submit" class="wf-btn wf-btn-danger">
              Yes, stop & save
            </button>
          </form>
        </div>
      </div>
    </Card>
  )
}
