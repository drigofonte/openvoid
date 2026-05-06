import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Eyebrow } from '../../../ui/eyebrow.tsx'

/**
 * Done (Stopped) view — rendered when the user deep-links to
 * `/sessions/:id` for a session that has already been stopped.
 *
 * The post-Stop happy path redirects to `/?done=:id&repo=&branch=`
 * which renders the green Done banner on the home page (with the
 * GitHub link). This view exists for the deep-link case where we
 * don't have repo/branch context to reconstruct that link.
 */

export interface DoneProps {
  sessionId: string
}

export function Done() {
  return ({ sessionId }: DoneProps) => (
    <Card padding="32px">
      <div class="wf-col" mix={css({ gap: '20px' })}>
        <div class="wf-col" mix={css({ gap: '6px' })}>
          <Eyebrow tone="ok">Saved</Eyebrow>
          <h1 class="wf-h1">This session has been stopped</h1>
          <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
            The agent's edits have been pushed to{' '}
            <code class="wf-mono">feat/{sessionId}</code> on your repo. The dev
            environment is no longer running.
          </p>
        </div>

        <div class="wf-row" mix={css({ gap: '12px', justifyContent: 'flex-end' })}>
          <a class="wf-btn wf-btn-pri" href="/" mix={css({ textDecoration: 'none' })}>
            Start another
          </a>
        </div>
      </div>
    </Card>
  )
}
