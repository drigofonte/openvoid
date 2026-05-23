import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Cluster } from '../../../ui/layout/cluster.tsx'
import { Cover } from '../../../ui/layout/cover.tsx'
import { Stack } from '../../../ui/layout/stack.tsx'
import { Switcher } from '../../../ui/layout/switcher.tsx'
import { Connector } from '../../../ui/connector.tsx'
import { ShortcutHint } from '../../../ui/client/shortcut-hint.tsx'
import { UrlRow } from '../../../ui/url-row.tsx'
import { agentLinkUrl } from '../../../utils/agent-url.ts'
import { CopyButton } from '../client/copy-button.tsx'
import { OpenLinkShortcuts } from '../client/open-link-shortcuts.tsx'
import { StopButton } from '../client/stop-button.tsx'

/**
 * Ready view — the magic-moment payoff, redesigned per
 * `docs/designs/Two-Links Hi-Fi.html`.
 *
 * Composition:
 *
 *   Cover (centered)
 *     └── stage (max-width: var(--w-stage), centered)
 *           └── Stack
 *                 ├── Hero      (visually narrower via inner var(--w-prose) wrapper)
 *                 ├── Duo       (.wf-connector-host wrapping Connector + Switcher)
 *                 ├── SplitTip
 *                 └── DoneLine  (StopButton's prose-link SSR fallback)
 *
 * The single outer max-width wrapper around the Stack is the
 * one place width is constrained — every Stack child then fills
 * that 760px width via the Stack's default cross-axis stretch.
 * No per-row max-width plumbing.
 *
 * The thin-wrapper primitives (LivePill, ReadyPill, IconMark,
 * SplitTip) live as inline class-based recipes here — composed
 * from the `.wf-*` rules under `public/styles/blocks/` and
 * `public/styles/compositions/`. The
 * platform-aware Cmd/Ctrl + Shift + digit kbd group lives in
 * `app/ui/client/shortcut-hint.tsx` as a clientEntry (it needs
 * `navigator` to swap the modifier glyph).
 *
 * Stop is still a clientEntry-driven button; its outer JSX
 * (`stop-button.tsx`) emits the done-line prose link as the SSR
 * fallback. Hydration intercepts the click and opens the in-page
 * confirm dialog.
 */

export interface ReadyProps {
  sessionId: string
  agentUrl: string
  previewUrl: string
  /** OpenCode session id for the auto-seeded `Main` conversation.
   *  Present on new-app pods (gates the deep-link URL form), absent
   *  on import-repo pods (which fall back to the bare `agentUrl`). */
  agentSessionId?: string
}

export function Ready() {
  return ({ sessionId, agentUrl, previewUrl, agentSessionId }: ReadyProps) => {
    // Composed once at the top of the tree so every consumer (UrlRow,
    // CopyButton, Open-chat <a>, OpenLinkShortcuts) hands the user the
    // same URL — what's displayed equals what's copied and clicked.
    const chatUrl = agentLinkUrl(agentUrl, agentSessionId)
    return (
      <Cover
        minHeight="calc(100vh - var(--h-header))"
        space="var(--sp-10)"
        centered={
          // 920px matches the Two-Links Hi-Fi reference's stage width.
          // Wider than --w-stage (760, the canonical composer width)
          // because the Ready hero is an editorial stage, not a
          // composer surface.
          <div
            mix={css({
              maxWidth: '920px',
              marginLeft: 'auto',
              marginRight: 'auto',
              width: '100%',
            })}
          >
            <Stack space="var(--sp-10)">
              <Hero />
              <Duo previewUrl={previewUrl} chatUrl={chatUrl} />
              <SplitTip />
              <StopButton sessionId={sessionId} />
              <OpenLinkShortcuts chatHref={chatUrl} previewHref={previewUrl} />
            </Stack>
          </div>
        }
      />
    )
  }
}

function Hero() {
  return () => (
    <div
      mix={css({
        textAlign: 'center',
        maxWidth: 'var(--w-prose)',
        marginLeft: 'auto',
        marginRight: 'auto',
        width: '100%',
      })}
    >
      <Stack space="var(--sp-6)">
        <div mix={css({ display: 'flex', justifyContent: 'center' })}>
          <span class="pill live">
            <span class="d" />
            Sandbox ready
          </span>
        </div>
        <h1
          tabindex={-1}
          mix={css({
            fontSize: 'var(--fs-display)',
            lineHeight: 'var(--lh-tight)',
            letterSpacing: 'var(--ls-display)',
            fontWeight: 'var(--fw-semi)',
            margin: 0,
            color: 'var(--ink)',
          })}
        >
          Two tabs, and you're building.
        </h1>
        <p
          mix={css({
            fontSize: '15.5px',
            color: 'var(--ink)',
            margin: 0,
            lineHeight: 'var(--lh-normal)',
          })}
        >
          Drive the agent on one. Watch the app come to life on the other.
          We'll save your work when you're done.
        </p>
      </Stack>
    </div>
  )
}

interface DuoProps {
  previewUrl: string
  chatUrl: string
}

function Duo() {
  return ({ previewUrl, chatUrl }: DuoProps) => (
    <div class="wf-connector-host">
      <Connector />
      {/* threshold=45rem (720px) — matches the Two-Links Hi-Fi
          reference's `@media (max-width: 760px)` 1-column
          breakpoint. Default 30rem only stacks below ~500px
          viewport, which is too narrow for two card-shaped
          children carrying URL rows + action buttons. */}
      <Switcher limit={2} space="var(--sp-9)" threshold="45rem">
        <ChatCard chatUrl={chatUrl} />
        <PreviewCard previewUrl={previewUrl} />
      </Switcher>
    </div>
  )
}

function ChatCard() {
  return ({ chatUrl }: { chatUrl: string }) => (
    <Card variant="elevated" accentTop>
      <Stack space="var(--sp-7)">
        {/* `stack-split` on the top block absorbs the card's free
            vertical space, so the URL row + action button anchor
            to the bottom edge regardless of how many lines the
            description wraps to. */}
        <div class="stack-split">
          <Cluster space="var(--sp-5)" align="flex-start">
            <span class="wf-icon-mark wf-icon-mark-dark" aria-hidden="true">
              <ChatGlyph />
            </span>
            <div mix={css({ flex: '1', minWidth: 0 })}>
              <Stack space="var(--sp-2)">
                <span class="kicker" mix={css({ color: 'var(--accent)' })}>
                  01 · drive
                </span>
                <h2
                  mix={css({
                    margin: 0,
                    fontSize: 'var(--fs-h2)',
                    lineHeight: 'var(--lh-snug)',
                    letterSpacing: 'var(--ls-heading)',
                    fontWeight: 'var(--fw-semi)',
                    color: 'var(--ink)',
                  })}
                >
                  Agent chat
                </h2>
                <p
                  mix={css({
                    margin: 0,
                    fontSize: 'var(--fs-small)',
                    color: 'var(--ink-2)',
                    lineHeight: 'var(--lh-normal)',
                  })}
                >
                  Tell the agent what to build. Paste references. Ask for changes.
                </p>
              </Stack>
            </div>
          </Cluster>
        </div>
        <UrlRow url={chatUrl}>
          <CopyButton value={chatUrl} />
        </UrlRow>
        <Cluster justify="flex-start">
          <a
            class="btn-pri"
            href={chatUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open chat
            <ShortcutHint digit="1" />
          </a>
        </Cluster>
      </Stack>
    </Card>
  )
}

function PreviewCard() {
  return ({ previewUrl }: { previewUrl: string }) => (
    <Card variant="elevated">
      <Stack space="var(--sp-7)">
        <div class="stack-split">
          <Cluster space="var(--sp-5)" align="flex-start">
            <span class="wf-icon-mark wf-icon-mark-line" aria-hidden="true">
              <PreviewGlyph />
            </span>
            <div mix={css({ flex: '1', minWidth: 0 })}>
              <Stack space="var(--sp-2)">
                <span class="kicker" mix={css({ color: 'var(--ink-3)' })}>
                  02 · watch
                </span>
                <h2
                  mix={css({
                    margin: 0,
                    fontSize: 'var(--fs-h2)',
                    lineHeight: 'var(--lh-snug)',
                    letterSpacing: 'var(--ls-heading)',
                    fontWeight: 'var(--fw-semi)',
                    color: 'var(--ink)',
                  })}
                >
                  Live preview
                </h2>
                <p
                  mix={css({
                    margin: 0,
                    fontSize: 'var(--fs-small)',
                    color: 'var(--ink-2)',
                    lineHeight: 'var(--lh-normal)',
                  })}
                >
                  See the running app. Hot-reloads as the agent edits.
                </p>
              </Stack>
            </div>
          </Cluster>
        </div>
        <UrlRow url={previewUrl}>
          <CopyButton value={previewUrl} />
        </UrlRow>
        <Cluster justify="flex-start">
          <a
            class="btn-sec"
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open preview
            <ShortcutHint digit="2" />
          </a>
        </Cluster>
      </Stack>
    </Card>
  )
}

function SplitTip() {
  return () => (
    <div class="wf-split-tip">
      <div class="wf-split-icon" aria-hidden="true">
        <span />
        <span />
      </div>
      <div class="wf-split-text">
        Drag both tabs into a split window — the agent on one side, the preview on the other.
      </div>
    </div>
  )
}

function ChatGlyph() {
  return () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3.5 6a2.5 2.5 0 0 1 2.5-2.5h8a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5H10l-3.5 3v-3H6A2.5 2.5 0 0 1 3.5 11V6z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function PreviewGlyph() {
  return () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="4"
        width="14"
        height="11"
        rx="1.5"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <path d="M3 7.5h14" stroke="currentColor" stroke-width="1.5" />
      <circle cx="5.5" cy="5.75" r="0.5" fill="currentColor" />
      <circle cx="7" cy="5.75" r="0.5" fill="currentColor" />
    </svg>
  )
}
