import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Eyebrow } from '../../../ui/eyebrow.tsx'

/**
 * Ready view (wireframe variant 04-A) — the magic-moment payoff.
 *
 * Two side-by-side cards show the agent UI and the live preview.
 * Both URLs come from the Session API and have already passed the
 * ingress-readiness probe by the time this renders.
 *
 * Stop is rendered as a link to `?confirm=stop` rather than a
 * native form-with-confirm — the SSR-friendly pattern is
 * navigate-to-confirm-page → click "Yes, stop" → POST. The
 * `clientEntry` confirm dialog lands in Unit 4b.
 */

export interface ReadyProps {
  sessionId: string
  agentUrl: string
  previewUrl: string
}

export function Ready() {
  return ({ sessionId, agentUrl, previewUrl }: ReadyProps) => (
    <div class="wf-col" mix={css({ gap: '20px' })}>
      <div class="wf-col" mix={css({ gap: '6px' })}>
        <Eyebrow tone="ok">Ready</Eyebrow>
        <h1 class="wf-h1">Your session is live</h1>
        <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
          The agent is running and your preview is reachable. Closing this tab
          will leave the session running — use Stop to commit edits and shut it
          down.
        </p>
      </div>

      <div
        class="wf-row"
        mix={css({ gap: '16px', alignItems: 'stretch', flexWrap: 'wrap' })}
      >
        <Card padding="20px">
          <div
            class="wf-col"
            mix={css({ gap: '10px', minWidth: '260px', flex: '1 1 260px' })}
          >
            <Eyebrow>Agent</Eyebrow>
            <h2 class="wf-h3">OpenCode UI</h2>
            <p class="wf-muted" mix={css({ fontSize: '13px', lineHeight: 1.5, margin: 0 })}>
              Talk to the agent and review its plan + edits.
            </p>
            <a class="wf-link" href={agentUrl} target="_blank" rel="noopener noreferrer">
              Open agent →
            </a>
          </div>
        </Card>

        <Card padding="20px">
          <div
            class="wf-col"
            mix={css({ gap: '10px', minWidth: '260px', flex: '1 1 260px' })}
          >
            <Eyebrow>Preview</Eyebrow>
            <h2 class="wf-h3">Live preview</h2>
            <p class="wf-muted" mix={css({ fontSize: '13px', lineHeight: 1.5, margin: 0 })}>
              Your app, served from the session's port 3000.
            </p>
            <a class="wf-link" href={previewUrl} target="_blank" rel="noopener noreferrer">
              Open preview →
            </a>
          </div>
        </Card>
      </div>

      <div
        class="wf-row"
        mix={css({ gap: '12px', justifyContent: 'space-between', alignItems: 'center' })}
      >
        <span class="wf-faint" mix={css({ fontSize: '12.5px' })}>
          <span class="wf-mono">{sessionId}</span>
        </span>
        <a
          class="wf-btn wf-btn-danger"
          href={`/sessions/${sessionId}?confirm=stop`}
          mix={css({ textDecoration: 'none' })}
        >
          Stop & save
        </a>
      </div>
    </div>
  )
}
