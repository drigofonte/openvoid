import { css } from 'remix/ui'

import { Avatar } from '../../ui/avatar.tsx'
import { Layout } from '../../ui/layout.tsx'
import { Cluster } from '../../ui/layout/cluster.tsx'
import { Stack } from '../../ui/layout/stack.tsx'
import { AutoGrowTextarea } from './client/auto-grow-textarea.tsx'
import { DerivedSlug } from './client/derived-slug.tsx'
import { StartSessionButton } from './client/start-session-button.tsx'
import { SuggestionChips } from './client/suggestion-chips.tsx'
import { DoneBanner, type DoneParams } from './done-banner.tsx'

/**
 * Suggestion chips for the "try" row. Each entry has a short
 * `label` (the chip's visible text) and a longer `fill` (the
 * full prompt that replaces the textarea content on click).
 */
const SUGGESTIONS = [
  {
    label: 'Notion-style notes',
    fill: 'A Notion-style note app with markdown, slash commands, and per-page sharing.',
  },
  {
    label: 'URL shortener',
    fill: 'A URL shortener with custom slugs, click analytics, and a dashboard.',
  },
  {
    label: 'Habit tracker',
    fill: 'A daily habit tracker with streaks, weekly emails, and a public profile.',
  },
  {
    label: 'Internal admin panel',
    fill: 'An internal admin panel for our Postgres database with role-based auth.',
  },
] as const

const ALTS = [
  {
    label: 'Start from a template',
    d: 'M3 3h18v18H3zM9 9h6v6H9z',
  },
  {
    label: 'Import GitHub repo',
    d: 'M9 19c-5 1.5-5-2.5-7-3M15 22v-3.9a3.4 3.4 0 0 0-.9-2.6C17 15.2 20 14 20 9.3a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.7 11.7 0 0 0-6.4 0C6.4 2.6 5.4 2.9 5.4 2.9a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.3c0 4.6 3 5.9 5.9 6.2a3.4 3.4 0 0 0-.9 2.6V22',
  },
  {
    label: 'Upload codebase (.zip)',
    d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8L12 3 7 8M12 3v12',
  },
  {
    label: 'Fork an example',
    d: 'M3 3h18v18H3zM3 9h18M9 21V9',
  },
] as const

// Stable DOM ids the composer's clientEntries hydrate against.
// Hoisting prevents drift when one site renames in isolation.
const PROMPT_ID = 'prompt'
const SLUG_ID = 'lives-at-slug'
const SLUG_WRAPPER_ID = 'lives-at-wrap'

export interface PreviousValues {
  prompt?: string
}

export interface HomePageProps {
  done?: DoneParams | null
  idempotencyKey: string
  error?: { message: string; code?: string } | null
  previousValues?: PreviousValues
}

/**
 * The Create page — redesigned per
 * `docs/designs/Create Prompt Hi-Fi.html`.
 *
 * Composition (matches the layout-primitive learning at
 * `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md`):
 * banners above an outer max-width wrapper, then a single Stack
 * holding [Hero, Composer, Alts, Suggestions, Footer]. No per-row
 * width plumbing.
 *
 * The form posts `{ prompt, idempotencyKey }`; the controller
 * injects DEFAULT_REPO and DEFAULT_BRANCH server-side via
 * `formData.set` so `CreateSchema` validation continues to pass
 * without a Session-API contract change. Repo selection at the
 * user-facing layer is deferred to a separate plan.
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
      topBarChrome={{ mode: 'crumbs', here: 'new app' }}
      mainKind="full"
      topBarRight={<HeaderRight />}
    >
      <div
        mix={css({
          maxWidth: 'var(--w-stage)',
          marginLeft: 'auto',
          marginRight: 'auto',
          width: '100%',
          padding: '80px 24px 80px',
        })}
      >
        <Stack space="var(--sp-9)">
          {done ? <DoneBanner done={done} /> : null}
          {error ? <ActionErrorBanner error={error} /> : null}
          <Hero />
          <Composer idempotencyKey={idempotencyKey} previousPrompt={previousValues.prompt} />
          <Alts />
          <Suggestions />
          <Footer />
        </Stack>
      </div>
    </Layout>
  )
}

function HeaderRight() {
  return () => (
    <Cluster space="var(--sp-5)">
      <a
        href="/"
        mix={css({
          fontSize: '12.5px',
          color: 'var(--ink-3)',
          textDecoration: 'none',
          padding: '6px 10px',
          borderRadius: '6px',
        })}
      >
        ← Back to apps
      </a>
      <Avatar />
    </Cluster>
  )
}

function ActionErrorBanner() {
  return ({ error }: { error: { message: string; code?: string } }) => (
    <div
      role="alert"
      class="wf-card"
      mix={css({
        padding: '14px 16px',
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
  )
}

function Hero() {
  return () => (
    <div mix={css({ maxWidth: 'var(--w-card)', textAlign: 'left' })}>
      <Stack space="var(--sp-3)">
        <h1
          mix={css({
            fontSize: 'var(--fs-display)',
            lineHeight: 'var(--lh-tight)',
            letterSpacing: 'var(--ls-display)',
            fontWeight: 'var(--fw-semi)',
            margin: 0,
            color: 'var(--ink)',
          })}
        >
          Let's make something.
        </h1>
        <p
          mix={css({
            fontSize: '15.5px',
            color: 'var(--ink)',
            margin: 0,
            lineHeight: 'var(--lh-normal)',
          })}
        >
          Describe your idea — the agent scaffolds the project, sets up your stack,
          and opens a chat session you'll keep coming back to.
        </p>
      </Stack>
    </div>
  )
}

interface ComposerProps {
  idempotencyKey: string
  previousPrompt?: string
}

function Composer() {
  return ({ idempotencyKey, previousPrompt }: ComposerProps) => (
    <form method="post" action="/" class="wf-composer">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label for={PROMPT_ID} class="sr-only">
        Prompt
      </label>
      <textarea
        id={PROMPT_ID}
        name={PROMPT_ID}
        rows={5}
        required
        autofocus
        placeholder="A weekend planner that pulls events from my Google calendar, lets me drag them onto a 2-day grid, and emails me a summary every Friday at 5pm."
        mix={css({
          width: '100%',
          border: 0,
          outline: 0,
          resize: 'none',
          background: 'transparent',
          fontFamily: 'var(--font-sans)',
          fontSize: '18px',
          lineHeight: 1.55,
          color: 'var(--ink)',
          letterSpacing: '-0.005em',
          minHeight: '118px',
          fontWeight: 400,
          padding: '22px 24px 8px',
        })}
      >
        {previousPrompt}
      </textarea>
      <div id={SLUG_WRAPPER_ID} class="wf-livesat" data-hidden="">
        <span class="wf-livesat-prefix">Will live at</span>
        <span class="wf-livesat-name">
          <span id={SLUG_ID}>untitled</span>.openvoid.dev
        </span>
      </div>
      <DerivedSlug targetId={PROMPT_ID} slugId={SLUG_ID} wrapperId={SLUG_WRAPPER_ID} />
      <div class="wf-composer-bar">
        <Cluster space="var(--sp-3)">
          <button type="button" class="wf-tool" title="Coming soon">
            <Glyph d="M21 11.5l-8.5 8.5a5 5 0 1 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L11 17a2 2 0 1 1-3-3l7-7" />
            Attach
          </button>
          <button type="button" class="wf-tool" title="Coming soon">
            <Glyph d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5" />
            Stack: <span class="wf-tool-key">auto</span>
          </button>
          <button type="button" class="wf-tool" title="Coming soon">
            <Glyph d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
            DB: <span class="wf-tool-key">postgres</span>
          </button>
        </Cluster>
        <span class="wf-submit-area">
          <span class="wf-submit-hint">
            <span class="wf-keycap">⌘</span>
            <span class="wf-keycap">↵</span>
            <span mix={css({ marginLeft: '4px' })}>to start</span>
          </span>
          <StartSessionButton targetId={PROMPT_ID} />
        </span>
      </div>
      <AutoGrowTextarea targetId={PROMPT_ID} maxHeight={360} />
    </form>
  )
}

function Alts() {
  return () => (
    <Cluster space="var(--sp-3)" justify="center">
      {ALTS.map((alt) => (
        <button type="button" class="wf-alt" data-coming-soon="" title="Coming soon">
          <Glyph d={alt.d} size={13} />
          {alt.label}
        </button>
      ))}
    </Cluster>
  )
}

function Suggestions() {
  return () => (
    <Cluster space="10px" justify="center">
      <span
        mix={css({
          fontSize: '12px',
          color: 'var(--ink-3)',
          fontWeight: 500,
          letterSpacing: '0.02em',
        })}
      >
        try
      </span>
      <SuggestionChips targetId={PROMPT_ID} suggestions={[...SUGGESTIONS]} />
    </Cluster>
  )
}

function Footer() {
  return () => (
    <p
      mix={css({
        fontSize: '12.5px',
        color: 'var(--ink-3)',
        margin: '24px 0 0',
        textAlign: 'left',
      })}
    >
      Provisioning a fresh sandbox usually takes 10–25 seconds.{' '}
      <a
        href="#"
        mix={css({
          color: 'var(--ink-2)',
          textDecoration: 'none',
          fontWeight: 500,
          borderBottom: '1px solid var(--line)',
          paddingBottom: '1px',
        })}
      >
        What runs in there?
      </a>
    </p>
  )
}

/**
 * Single SVG glyph slot. Toolbar tools use 14px; alts row uses
 * 13px. Path strings live next to the labels they decorate
 * (`SUGGESTIONS` / `ALTS` arrays + the inline `<Glyph d="…" />`
 * call sites in `Composer`), so adding a glyph is one row change
 * instead of one row + one component + one union member.
 */
function Glyph() {
  return ({ d, size = 14 }: { d: string; size?: number }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}
