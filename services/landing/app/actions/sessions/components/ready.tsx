import { css } from 'remix/ui'

import { Card } from '../../../ui/card.tsx'
import { Eyebrow } from '../../../ui/eyebrow.tsx'
import { StopButton } from '../client/stop-button.tsx'

/**
 * Ready view (wireframe variant 04-A) — the magic-moment payoff.
 *
 * Heading + body sit outside the card grid; below them, two
 * side-by-side cards (Agent chat / Live preview), each with a
 * coloured icon, a title, a "↗ new tab" chip, a truncated URL
 * preview, and a full-width "Open …" button. Bottom of the page
 * carries a pro-tip banner and the Stop button.
 *
 * Stop is a clientEntry-driven button: by default it's a plain
 * `<a href="?confirm=stop">` link the browser can navigate to (so
 * the flow works without JS). On hydration the click is intercepted
 * and an in-page confirm dialog opens.
 */

export interface ReadyProps {
  sessionId: string
  agentUrl: string
  previewUrl: string
}

export function Ready() {
  return ({ sessionId, agentUrl, previewUrl }: ReadyProps) => (
    <div
      class="wf-col"
      mix={css({
        gap: '24px',
        maxWidth: '720px',
        width: '100%',
        marginLeft: 'auto',
        marginRight: 'auto',
      })}
    >
      <div class="wf-col" mix={css({ gap: '8px' })}>
        <Eyebrow tone="ok">Session ready</Eyebrow>
        <h1
          class="wf-h1 wf-mono"
          tabindex={-1}
          mix={css({ fontSize: '22px', wordBreak: 'break-all' })}
        >
          {sessionId}
        </h1>
        <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
          Two tabs to open. Keep both around — chat tells the agent what to do,
          preview shows the result.
        </p>
      </div>

      <div
        mix={css({
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          alignItems: 'stretch',
        })}
      >
        <ToolCard
          tone="dark"
          glyph="◐"
          title="Agent chat"
          subtitle="Tell the agent what to build, paste references, ask for changes."
          url={agentUrl}
          buttonLabel="Open chat →"
        />
        <ToolCard
          tone="accent"
          glyph="◇"
          title="Live preview"
          subtitle="See the running app. Hot-reloads as the agent edits."
          url={previewUrl}
          buttonLabel="Open preview →"
        />
      </div>

      <div
        class="wf-card"
        mix={css({
          padding: '12px 16px',
          background: 'var(--wf-warn-soft)',
          borderColor: 'transparent',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13px',
          color: 'var(--wf-fg)',
        })}
      >
        <span aria-hidden="true">💡</span>
        <span>
          <strong mix={css({ fontWeight: 600 })}>Pro tip:</strong> drag both tabs
          into a split window. When you're done, come back here and kill the
          session to commit.
        </span>
      </div>

      <div
        class="wf-row"
        mix={css({ gap: '12px', justifyContent: 'space-between', alignItems: 'center' })}
      >
        <span class="wf-faint" mix={css({ fontSize: '12.5px' })}>
          <span class="wf-mono">{sessionId}</span>
        </span>
        <StopButton sessionId={sessionId} />
      </div>
    </div>
  )
}

interface ToolCardProps {
  tone: 'dark' | 'accent'
  glyph: string
  title: string
  subtitle: string
  url: string
  buttonLabel: string
}

function ToolCard() {
  return ({ tone, glyph, title, subtitle, url, buttonLabel }: ToolCardProps) => {
    const iconBg = tone === 'dark' ? 'var(--wf-fg)' : 'var(--wf-accent)'
    return (
      <Card padding="20px">
      <div
        class="wf-col"
        mix={css({ gap: '12px', minWidth: 0 })}
      >
        <div class="wf-row" mix={css({ gap: '12px', alignItems: 'center' })}>
          <span
            aria-hidden="true"
            mix={css({
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: iconBg,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
            })}
          >
            {glyph}
          </span>
          <h2 class="wf-h3" mix={css({ flex: '1' })}>{title}</h2>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            class="wf-chip"
            mix={css({ textDecoration: 'none', cursor: 'pointer' })}
          >
            ↗ new tab
          </a>
        </div>

        <p class="wf-muted" mix={css({ fontSize: '13px', lineHeight: 1.5, margin: 0 })}>
          {subtitle}
        </p>

        <div
          class="wf-input wf-mono"
          aria-hidden="true"
          mix={css({
            fontSize: '12px',
            color: 'var(--wf-fg-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
          })}
        >
          {url}
        </div>

        <a
          class="wf-btn wf-btn-pri"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          mix={css({
            textDecoration: 'none',
            justifyContent: 'center',
            width: '100%',
            height: '36px',
          })}
        >
          {buttonLabel}
        </a>
      </div>
    </Card>
    )
  }
}
