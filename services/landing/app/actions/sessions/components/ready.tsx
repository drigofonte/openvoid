import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Cluster } from '../../../ui/layout/cluster.tsx'
import { Cover } from '../../../ui/layout/cover.tsx'
import { Stack } from '../../../ui/layout/stack.tsx'
import { Switcher } from '../../../ui/layout/switcher.tsx'
import { Connector } from '../../../ui/connector.tsx'
import { UrlRow } from '../../../ui/url-row.tsx'
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
 *     └── Stack
 *           ├── Hero (ReadyPill + h1 + subtitle)
 *           ├── Duo  (.wf-connector-host wrapping Connector + Switcher[Chat, Preview])
 *           ├── SplitTip
 *           └── DoneLine (StopButton's prose-link SSR fallback)
 *
 * Five primitives the doc review flagged as thin wrappers
 * (Kbd, LivePill, ReadyPill, IconMark, SplitTip) live as inline
 * class-based recipes here — composed from the `.wf-*` rules
 * added to `blocks.css` in U1.
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
}

export function Ready() {
  return ({ sessionId, agentUrl, previewUrl }: ReadyProps) => (
    <Cover
      minHeight="calc(100vh - var(--h-header))"
      space="var(--sp-10)"
      centered={
        <Stack space="var(--sp-10)">
          <Hero />
          <Duo agentUrl={agentUrl} previewUrl={previewUrl} />
          <SplitTip />
          <StopButton sessionId={sessionId} />
          <OpenLinkShortcuts chatHref={agentUrl} previewHref={previewUrl} />
        </Stack>
      }
    />
  )
}

function Hero() {
  return () => (
    <div
      mix={css({
        textAlign: 'center',
        maxWidth: 'var(--w-prose)',
        marginLeft: 'auto',
        marginRight: 'auto',
      })}
    >
      <Stack space="var(--sp-6)">
        <div mix={css({ display: 'flex', justifyContent: 'center' })}>
          <span class="wf-pill-ready">
            <span class="wf-pill-dot" />
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
            maxWidth: 'var(--w-card)',
            marginLeft: 'auto',
            marginRight: 'auto',
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
  agentUrl: string
  previewUrl: string
}

function Duo() {
  return ({ agentUrl, previewUrl }: DuoProps) => (
    <div
      class="wf-connector-host"
      mix={css({
        maxWidth: 'var(--w-stage)',
        width: '100%',
        marginLeft: 'auto',
        marginRight: 'auto',
      })}
    >
      <Connector />
      <Switcher limit={2} space="var(--sp-9)">
        <ChatCard agentUrl={agentUrl} />
        <PreviewCard previewUrl={previewUrl} />
      </Switcher>
    </div>
  )
}

function ChatCard() {
  return ({ agentUrl }: { agentUrl: string }) => (
    <Card variant="elevated" accentTop>
      <Stack space="var(--sp-7)">
        <Cluster space="var(--sp-5)" align="flex-start">
          <span class="wf-icon-mark wf-icon-mark-dark" aria-hidden="true">
            <ChatGlyph />
          </span>
          <div mix={css({ flex: '1', minWidth: 0 })}>
            <Stack space="var(--sp-2)">
              <span class="wf-eyebrow" mix={css({ color: 'var(--accent)' })}>
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
        <UrlRow url={agentUrl}>
          <CopyButton value={agentUrl} />
        </UrlRow>
        <Cluster justify="flex-start">
          <a
            class="wf-btn-action wf-btn-action-pri"
            href={agentUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open chat
            <Kbd>⌘1</Kbd>
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
        <Cluster space="var(--sp-5)" align="flex-start">
          <span class="wf-icon-mark wf-icon-mark-line" aria-hidden="true">
            <PreviewGlyph />
          </span>
          <div mix={css({ flex: '1', minWidth: 0 })}>
            <Stack space="var(--sp-2)">
              <span class="wf-eyebrow" mix={css({ color: 'var(--ink-3)' })}>
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
        <UrlRow url={previewUrl}>
          <CopyButton value={previewUrl} />
        </UrlRow>
        <Cluster justify="flex-start">
          <a
            class="wf-btn-action wf-btn-action-sec"
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open preview
            <Kbd>⌘2</Kbd>
          </a>
        </Cluster>
      </Stack>
    </Card>
  )
}

function SplitTip() {
  return () => (
    <div
      class="wf-split-tip"
      mix={css({
        maxWidth: 'var(--w-stage)',
        marginLeft: 'auto',
        marginRight: 'auto',
      })}
    >
      <div class="wf-split-icon" aria-hidden="true">
        <span />
        <span />
      </div>
      <div class="wf-split-text">
        Drag both tabs into a split window — the agent on one side, the preview on the other.
      </div>
      <div class="wf-split-kbd" aria-hidden="true">
        <span class="wf-keycap">⌘</span>
        <span class="wf-keycap">⇧</span>
        <span class="wf-keycap">D</span>
      </div>
    </div>
  )
}

function Kbd() {
  return ({ children }: { children: string }) => (
    <span class="wf-keycap">{children}</span>
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
