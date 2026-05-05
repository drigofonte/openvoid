import { css } from 'remix/ui'
import { Layout } from '../../ui/layout.tsx'
import { Card } from '../../ui/card.tsx'
import { Eyebrow } from '../../ui/eyebrow.tsx'

/**
 * Placeholder home page — Unit 1 scaffold. Confirms the layout +
 * design tokens render correctly. Unit 3 replaces this with the
 * full Create screen (full-page prompt-first form, suggestion chips,
 * Done banner when `?done=` is present).
 */
export function HomePage() {
  return () => (
    <Layout title="openvoid" url="app.127.0.0.1.nip.io">
      <Card padding="32px">
        <div class="wf-col" mix={css({ gap: '12px' })}>
          <Eyebrow>Step 0 of 1 · scaffold</Eyebrow>
          <h1 class="wf-h1">openvoid</h1>
          <p class="wf-muted" mix={css({ lineHeight: 1.6 })}>
            Hello, openvoid — the Remix 3 scaffold is up. The Create
            screen lands in Unit 3 of the landing-redesign plan.
          </p>
          <div class="wf-row" mix={css({ gap: '8px', marginTop: '8px' })}>
            <span class="wf-chip wf-chip-acc">remix@3.0.0-beta.0</span>
            <span class="wf-chip">node 24+</span>
            <span class="wf-chip">tsx</span>
          </div>
        </div>
      </Card>
    </Layout>
  )
}
