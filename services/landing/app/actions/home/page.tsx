import { css } from 'remix/ui'

import { Card } from '../../ui/card.tsx'
import { Eyebrow } from '../../ui/eyebrow.tsx'
import { Input } from '../../ui/input.tsx'
import { Layout } from '../../ui/layout.tsx'
import { Textarea } from '../../ui/textarea.tsx'
import { SubmitButton } from './client/submit-button.tsx'
import { SuggestionChips } from './client/suggestion-chips.tsx'
import { DoneBanner, type DoneParams } from './done-banner.tsx'

/**
 * Short chip labels matching the wireframe's "Try:" row. Clicking
 * a chip drops the label text into the prompt textarea as a starter;
 * the user is expected to flesh it out before submitting.
 */
const SUGGESTIONS = [
  'Notion clone',
  'URL shortener',
  'Habit tracker',
  'Internal admin panel',
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
 * Layout (top → bottom):
 *   1. Done banner (when `?done=` is present)
 *   2. Inline error banner (when the create action failed)
 *   3. Eyebrow + heading + subhead (centered, outside the card)
 *   4. Card with prompt textarea + bottom toolbar
 *   5. "Try:" suggestion chips
 *   6. Advanced expander (repo + branch — required, but visually
 *      deferred since the wireframes show a prompt-only flow)
 */
export function HomePage() {
  return ({
    done = null,
    idempotencyKey,
    error = null,
    previousValues = {},
  }: HomePageProps) => (
    <Layout
      title="openvoid — start a session"
      topBarChrome={{ mode: 'path', path: '/new' }}
      topBarRight={
        <a
          href="/"
          class="wf-btn wf-btn-ghost"
          mix={css({ textDecoration: 'none' })}
        >
          Cancel
        </a>
      }
    >
      {done ? <DoneBanner done={done} /> : null}
      {error ? (
        <div
          role="alert"
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
        </div>
      ) : null}

      <form
        method="post"
        action="/"
        class="wf-col"
        mix={css({ gap: '24px', alignItems: 'stretch' })}
      >
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <div
          class="wf-col"
          mix={css({ gap: '8px', alignItems: 'center', textAlign: 'center', marginTop: '16px' })}
        >
          <Eyebrow>Step 1 of 1</Eyebrow>
          <h1 class="wf-h1" mix={css({ fontSize: '28px', margin: 0 })}>
            What should we build today?
          </h1>
          <p
            class="wf-muted"
            mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}
          >
            Describe the app — the agent will scaffold and start a session.
          </p>
        </div>

        <Card padding="16px">
          <div class="wf-col" mix={css({ gap: '12px' })}>
            <label for="prompt" class="sr-only">
              Prompt
            </label>
            <Textarea
              name="prompt"
              id="prompt"
              rows={5}
              required
              placeholder="A weekend planner that pulls events from my Google calendar, lets me drag them onto a 2-day grid, and emails me a summary Friday at 5pm."
              defaultValue={previousValues.prompt}
            />

            <div
              class="wf-row"
              mix={css({
                gap: '8px',
                flexWrap: 'wrap',
                paddingTop: '6px',
                borderTop: '1px solid var(--wf-line-soft)',
              })}
            >
              <button
                type="button"
                class="wf-chip"
                disabled
                aria-disabled="true"
                title="Coming soon"
                mix={css({ opacity: 0.6 })}
              >
                📎 Attach
              </button>
              <button
                type="button"
                class="wf-chip"
                disabled
                aria-disabled="true"
                title="Coming soon"
                mix={css({ opacity: 0.6 })}
              >
                Stack: auto
              </button>
              <button
                type="button"
                class="wf-chip"
                disabled
                aria-disabled="true"
                title="Coming soon"
                mix={css({ opacity: 0.6 })}
              >
                DB: postgres
              </button>
              <span class="wf-spacer" />
              <span
                class="wf-row"
                aria-hidden="true"
                mix={css({ gap: '4px', alignItems: 'center' })}
              >
                <span class="wf-keycap">⌘</span>
                <span class="wf-keycap">↵</span>
                <span class="wf-faint" mix={css({ fontSize: '12px', marginLeft: '4px' })}>
                  to start
                </span>
              </span>
              <SubmitButton label="Start session" />
            </div>
          </div>
        </Card>

        <div
          class="wf-row"
          mix={css({ gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' })}
        >
          <span class="wf-faint" mix={css({ fontSize: '12.5px' })}>Try:</span>
          <SuggestionChips targetId="prompt" suggestions={[...SUGGESTIONS]} />
        </div>

        <details
          class="wf-col"
          mix={css({ gap: '12px', marginTop: '8px', alignSelf: 'center', maxWidth: '640px', width: '100%' })}
        >
          <summary
            class="wf-muted"
            mix={css({
              fontSize: '12.5px',
              cursor: 'pointer',
              listStyle: 'none',
              userSelect: 'none',
            })}
          >
            Repository (advanced)
          </summary>
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
        </details>
      </form>
    </Layout>
  )
}
