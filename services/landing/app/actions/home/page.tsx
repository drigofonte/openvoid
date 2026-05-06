import { css } from 'remix/ui'

import { Button } from '../../ui/button.tsx'
import { Card } from '../../ui/card.tsx'
import { Chip } from '../../ui/chip.tsx'
import { Eyebrow } from '../../ui/eyebrow.tsx'
import { Input } from '../../ui/input.tsx'
import { Layout } from '../../ui/layout.tsx'
import { Textarea } from '../../ui/textarea.tsx'
import { DoneBanner, type DoneParams } from './done-banner.tsx'

/**
 * Wireframe-faithful suggestion-chip copy. In Unit 3 these are
 * static — clicking does nothing. The `clientEntry` that wires
 * chip click → textarea-replace lands in Unit 4 alongside the
 * polling Frame's asset-pipeline scaffolding.
 */
const SUGGESTIONS = [
  'A Notion-style notes app with markdown blocks.',
  'A URL shortener with click analytics.',
  'A habit tracker with streaks and reminders.',
  'An internal admin panel for managing users.',
] as const

export interface PreviousValues {
  repo?: string
  branch?: string
  prompt?: string
}

export interface HomePageProps {
  done?: DoneParams | null
  idempotencyKey: string
  error?: { message: string; code?: string } | null
  previousValues?: PreviousValues
}

/**
 * The Create screen — wireframe variant 02-B (full-page,
 * prompt-first). Renders a plain `<form method="post" action="/">`
 * so the flow works without JS; the server-rendered idempotency
 * key is the double-submit defence.
 *
 * Top-of-form areas in priority order:
 *   1. Done banner (when `?done=` is present)
 *   2. Inline error (when the create action failed)
 *   3. Eyebrow + heading
 *   4. Prompt textarea + suggestion chips
 *   5. Repo URL + branch row
 *   6. Inert "Stack: auto / DB: postgres / Attach 📎" chips
 *   7. Submit button
 */
export function HomePage() {
  return ({
    done = null,
    idempotencyKey,
    error = null,
    previousValues = {},
  }: HomePageProps) => (
    <Layout title="openvoid — start a session" url="app.openvoid.dev">
      {done ? <DoneBanner done={done} /> : null}
      {error ? (
        <aside
          class="wf-card"
          mix={css({
            padding: '14px 16px',
            marginBottom: '24px',
            borderColor: 'var(--wf-danger)',
            background: 'var(--wf-danger-soft)',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
          })}
        >
          <span class="wf-eyebrow" mix={css({ color: 'var(--wf-danger)' })}>
            Couldn't start
          </span>
          <span mix={css({ fontSize: '14px' })}>{error.message}</span>
        </aside>
      ) : null}

      <Card padding="32px">
        <form method="post" action="/" class="wf-col" mix={css({ gap: '20px' })}>
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

          <div class="wf-col" mix={css({ gap: '6px' })}>
            <Eyebrow>New session · Step 1 of 1</Eyebrow>
            <h1 class="wf-h1" mix={css({ margin: 0 })}>
              What should the agent build?
            </h1>
            <p
              class="wf-muted"
              mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}
            >
              Describe the change in plain English. We'll spin up a private dev
              environment, run the agent, and push commits to a fresh branch.
            </p>
          </div>

          <div class="wf-col" mix={css({ gap: '8px' })}>
            <label
              for="prompt"
              class="wf-eyebrow"
              mix={css({ color: 'var(--wf-fg-muted)' })}
            >
              Prompt
            </label>
            <Textarea
              name="prompt"
              id="prompt"
              rows={6}
              required
              placeholder="e.g. Add a /health endpoint that returns build SHA and uptime."
              defaultValue={previousValues.prompt}
            />
            <div class="wf-row" mix={css({ gap: '8px', flexWrap: 'wrap' })}>
              {SUGGESTIONS.map((text) => (
                <button
                  type="button"
                  class="wf-chip"
                  mix={css({ cursor: 'pointer' })}
                  data-suggestion={text}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <div
            class="wf-row"
            mix={css({ gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' })}
          >
            <div class="wf-col" mix={css({ gap: '8px', flex: '1 1 320px' })}>
              <label
                for="repo"
                class="wf-eyebrow"
                mix={css({ color: 'var(--wf-fg-muted)' })}
              >
                Git repo (HTTPS)
              </label>
              <Input
                name="repo"
                id="repo"
                type="url"
                required
                placeholder="https://github.com/your-org/your-repo"
                defaultValue={previousValues.repo}
              />
            </div>
            <div class="wf-col" mix={css({ gap: '8px', flex: '0 1 200px' })}>
              <label
                for="branch"
                class="wf-eyebrow"
                mix={css({ color: 'var(--wf-fg-muted)' })}
              >
                Base branch
              </label>
              <Input name="branch" id="branch" defaultValue={previousValues.branch ?? 'main'} />
            </div>
          </div>

          <div class="wf-row" mix={css({ gap: '8px', flexWrap: 'wrap' })}>
            <span title="Coming soon">
              <Chip>Stack: auto</Chip>
            </span>
            <span title="Coming soon">
              <Chip>DB: postgres</Chip>
            </span>
            <button
              type="button"
              class="wf-chip"
              disabled
              title="Coming soon"
              mix={css({ opacity: 0.6 })}
            >
              Attach 📎
            </button>
          </div>

          <div class="wf-row" mix={css({ gap: '12px', justifyContent: 'flex-end' })}>
            <Button variant="accent" type="submit">
              Start session
            </Button>
          </div>
        </form>
      </Card>
    </Layout>
  )
}
