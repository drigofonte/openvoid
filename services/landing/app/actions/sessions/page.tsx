import { css } from 'remix/ui'

import { Card } from '../../ui/card.tsx'
import { Eyebrow } from '../../ui/eyebrow.tsx'
import { Avatar } from '../../ui/avatar.tsx'
import { Layout } from '../../ui/layout.tsx'
import { isTerminal } from '../../utils/poll.ts'
import type { View } from '../../utils/derive.ts'
import { FocusH1 } from './client/focus-h1.tsx'
import { StatusPoller } from './client/status-poller.tsx'
import { Done } from './components/done.tsx'
import { Failed } from './components/failed.tsx'
import { KillConfirm } from './components/kill-confirm.tsx'
import { Provisioning } from './components/provisioning.tsx'
import { Ready } from './components/ready.tsx'
import { Stopping } from './components/stopping.tsx'

/**
 * The `/sessions/:id` page. Switches on the controller-derived
 * `view.kind` to render one of six states. The Ready view is
 * special-cased: when the URL carries `?confirm=stop`, swap to
 * KillConfirm without a controller round-trip — the confirm
 * dialog is a navigation, not a separate route.
 *
 * The optional `actionError` prop renders a red banner above the
 * view — used when stop/cancel fail mid-flight so the user sees
 * what went wrong and can retry. Without this, the controller's
 * 503-status response would render a Ready page indistinguishable
 * from a successful render.
 *
 * Refresh to advance state; the polling Frame lands in Unit 4b.
 */

export interface ActionError {
  message: string
  code?: string
}

export interface SessionPageProps {
  view: View
  confirmStop?: boolean
  actionError?: ActionError | null
}

export function SessionPage() {
  return ({ view, confirmStop = false, actionError = null }: SessionPageProps) => (
    <Layout
      title={pageTitle(view)}
      topBarChrome={{ mode: 'path', path: `/sessions/${view.sessionId}` }}
      topBarRight={<Avatar />}
    >
      <FocusH1 />
      <div role="status" aria-live="polite" class="sr-only">
        {phaseAnnouncement(view, confirmStop)}
      </div>
      {actionError ? <ActionErrorBanner error={actionError} /> : null}
      {renderView(view, confirmStop)}
      {isTerminal(view) ? null : (
        <StatusPoller
          sessionId={view.sessionId}
          initialKind={view.kind}
          initialPendingPhase={view.kind === 'provisioning' ? (view.pendingPhase ?? null) : null}
          initialAgentUrl={view.kind === 'ready' ? view.agentUrl : null}
          initialPreviewUrl={view.kind === 'ready' ? view.previewUrl : null}
        />
      )}
    </Layout>
  )
}

function phaseAnnouncement(view: View, confirmStop: boolean): string {
  if (confirmStop && view.kind === 'ready') return 'Stop session — confirm dialog'
  switch (view.kind) {
    case 'provisioning':
      return view.pendingPhase === 'running-pre-ingress'
        ? 'Almost ready — programming routes'
        : 'Provisioning your session'
    case 'ready':
      return 'Session ready — agent and preview links available'
    case 'stopping':
      return 'Stopping session'
    case 'done':
      return 'Session stopped and saved'
    case 'failed':
      return 'Session failed to provision'
  }
}

function ActionErrorBanner() {
  return ({ error }: { error: ActionError }) => (
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
        Couldn't stop
      </span>
      <span mix={css({ fontSize: '14px' })}>{error.message}</span>
    </div>
  )
}

function renderView(view: View, confirmStop: boolean) {
  switch (view.kind) {
    case 'provisioning':
      return <Provisioning sessionId={view.sessionId} pendingPhase={view.pendingPhase} />
    case 'ready':
      return confirmStop ? (
        <KillConfirm sessionId={view.sessionId} />
      ) : (
        <Ready
          sessionId={view.sessionId}
          agentUrl={view.agentUrl}
          previewUrl={view.previewUrl}
        />
      )
    case 'stopping':
      return <Stopping sessionId={view.sessionId} />
    case 'done':
      return <Done sessionId={view.sessionId} />
    case 'failed':
      return <Failed sessionId={view.sessionId} reason={view.reason} />
    default: {
      const exhaustive: never = view
      void exhaustive
      throw new Error('SessionPage: unknown view kind')
    }
  }
}

function pageTitle(view: View): string {
  switch (view.kind) {
    case 'ready':
      return 'openvoid — session ready'
    case 'failed':
      return 'openvoid — session failed'
    case 'done':
      return 'openvoid — session stopped'
    case 'stopping':
      return 'openvoid — saving session'
    case 'provisioning':
    default:
      return 'openvoid — provisioning'
  }
}

/**
 * Rendered when `getSessionWithRetry` exhausts retries (3 × 404).
 * Status code is set to 404 by the controller so logs / metrics
 * can distinguish a real "missing" from a transient one.
 */
export function SessionNotFoundPage() {
  return ({ sessionId }: { sessionId: string }) => (
    <Layout title="openvoid — session not found" topBarChrome={{ mode: 'path', path: '/sessions/not-found' }}>
      <FocusH1 />
      <Card padding="32px">
        <div class="wf-col" mix={css({ gap: '20px' })}>
          <div class="wf-col" mix={css({ gap: '6px' })}>
            <Eyebrow tone="danger">Not found</Eyebrow>
            <h1 class="wf-h1" tabindex={-1}>No session with that ID</h1>
            <p class="wf-muted" mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
              The session <span class="wf-mono">{sessionId}</span> doesn't
              exist or has already been cleaned up. Start a new one.
            </p>
          </div>
          <div class="wf-row" mix={css({ gap: '12px', justifyContent: 'flex-end' })}>
            <a class="wf-btn wf-btn-pri" href="/" mix={css({ textDecoration: 'none' })}>
              Back to start
            </a>
          </div>
        </div>
      </Card>
    </Layout>
  )
}
