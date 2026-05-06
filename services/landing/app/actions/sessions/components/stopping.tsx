import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Eyebrow } from '../../../ui/eyebrow.tsx'

/**
 * Stopping view — wireframe variant 06-B (kill-in-flight)
 * simplified for SSR. Reached by deep-linking to `/sessions/:id`
 * during the brief window after DELETE has been acknowledged but
 * before the Pod is fully gone.
 *
 * The clientEntry-driven log overlay (06-B's terminal stream)
 * lands in Unit 4b. For now, a spinner + status copy.
 */

export interface StoppingProps {
  sessionId: string
}

export function Stopping() {
  return ({ sessionId }: StoppingProps) => (
    <Card padding="32px">
      <div class="wf-col" mix={css({ gap: '20px' })}>
        <div class="wf-col" mix={css({ gap: '6px' })}>
          <Eyebrow>Stopping</Eyebrow>
          <h1 class="wf-h1">Saving and shutting down…</h1>
          <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
            Committing the agent's edits to a fresh{' '}
            <code class="wf-mono">feat/{sessionId}</code> branch on your repo,
            then tearing down the dev environment.
          </p>
        </div>

        <div class="wf-progress-track" mix={css({ width: '100%' })}>
          <div class="wf-progress-fill wf-pulse" mix={css({ width: '70%' })} />
        </div>

        <p class="wf-faint" mix={css({ fontSize: '12.5px', margin: 0 })}>
          <span class="wf-mono">{sessionId}</span> · refresh to check status
        </p>
      </div>
    </Card>
  )
}
