import { css } from 'remix/ui'

import { ProvisioningStoryboard } from '../client/provisioning-storyboard.tsx'

/**
 * Provisioning view (Hi-Fi shape).
 *
 * Stage-centered hero: canonical Eyebrow Pill (`Spinning up` with
 * breathing dot) → 24px mono session-id hero → lede copy → Boot
 * Sequence card (head + bar + 5-step list + log disclosure) →
 * footer with troubleshoot links.
 *
 * The card hosts the `ProvisioningStoryboard` clientEntry, which
 * drives the step list, ETA countdown, progress bar, and log
 * cursor on a single client-side timer anchored to
 * `sessionCreatedAt` (NOT to mount time — survives clientEntry
 * re-mounts on `pending → running-pre-ingress` transitions and
 * tab-backgrounding).
 *
 * Cancel lives in the page header (`topBarRight` slot, see
 * `sessions/page.tsx` ProvisioningHeaderSlot) — not in this body.
 *
 * Synthetic v1: no backend signal exists for per-step progress.
 * The storyboard's 25-second timeline + degraded long-running
 * state (past 30s elapsed) is documented as a deliberate bet in
 * plan 2026-05-12-001 Key Technical Decisions.
 */

export interface ProvisioningProps {
  sessionId: string
  pendingPhase?: 'pending' | 'running-pre-ingress'
  sessionCreatedAt?: string
}

const STATUS_COPY: Record<NonNullable<ProvisioningProps['pendingPhase']>, string> = {
  pending: 'Provisioning a fresh sandbox and warming up the agent.',
  'running-pre-ingress': 'Almost ready — programming routes for your agent and preview.',
}

const STEPS = [
  'Allocating sandbox',
  'Cloning starter template',
  'Installing dependencies',
  'Booting agent',
  'Mounting preview server',
] as const

export function Provisioning() {
  return ({ sessionId, pendingPhase, sessionCreatedAt }: ProvisioningProps) => {
    const status = pendingPhase ? STATUS_COPY[pendingPhase] : STATUS_COPY['pending']
    return (
      <main class="stage">
        <span class="eyebrow">
          <span class="dot live" />
          Spinning up
        </span>

        <div mix={css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' })}>
          <h1
            tabindex={-1}
            mix={css({
              fontSize: '24px',
              lineHeight: 1.1,
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              wordBreak: 'keep-all',
              overflowWrap: 'anywhere',
              margin: 0,
              textAlign: 'center',
            })}
          >
            {sessionId}
          </h1>
          <p
            mix={css({
              fontSize: '15px',
              color: 'var(--ink)',
              maxWidth: '480px',
              textAlign: 'center',
              lineHeight: 1.5,
              margin: 0,
            })}
          >
            {status} <b>You can close this tab</b> — we'll email you when it's ready.
          </p>
        </div>

        <div
          class="card-shell"
          data-storyboard
          mix={css({ width: '100%', maxWidth: '640px', padding: '28px 32px 26px', gap: '22px' })}
        >
          <div class="card-head">
            <span class="title">Boot sequence</span>
            <span class="eta" data-eta-wrap>
              <span class="num" id="eta">25</span>s remaining
            </span>
            <span class="eta" data-stuck-meta hidden>
              taking longer than usual
            </span>
          </div>

          <div class="bar">
            <div class="bar-fill" id="bar-fill" />
          </div>

          <ul class="steps">
            {STEPS.map((label, i) => (
              <li id={`step-${i}`} class={i === 0 ? 'step active' : 'step'}>
                <span class="check" />
                <span class="label">{label}</span>
              </li>
            ))}
          </ul>

          <button
            class="disc"
            type="button"
            aria-expanded="false"
            aria-controls="provisioning-log"
            data-disclosure
          >
            <svg
              class="chev"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            Show live log
          </button>
          <div class="log" id="provisioning-log">
            <div class="dim">$ openvoid sandbox up --name {sessionId}</div>
            <div><span class="ok">✓</span> sandbox allocated</div>
            <div><span class="ok">✓</span> base image pulled</div>
            <div><span class="ok">✓</span> repo initialized</div>
            <div>
              <span class="now">›</span> installing dependencies
              <span class="blink" id="log-cursor" />
            </div>
            <div class="dim">  pnpm install — in progress</div>
            <div class="dim">  ████████████████░░░░░░░░░</div>
          </div>
        </div>

        <p
          mix={css({
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--ink-3)',
            fontSize: '12.5px',
            margin: 0,
          })}
        >
          Trouble?{' '}
          <a href="#" mix={css({ color: 'var(--ink-2)', textDecoration: 'underline' })}>
            View full logs
          </a>{' '}
          or{' '}
          <a href="#" mix={css({ color: 'var(--ink-2)', textDecoration: 'underline' })}>
            restart provisioning
          </a>
          .
        </p>

        {sessionCreatedAt ? (
          <ProvisioningStoryboard sessionId={sessionId} sessionCreatedAt={sessionCreatedAt} />
        ) : null}
      </main>
    )
  }
}
