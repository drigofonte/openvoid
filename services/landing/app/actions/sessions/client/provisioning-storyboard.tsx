import { clientEntry, type Handle } from 'remix/ui'

import type { PendingPhase } from '../../../utils/derive.ts'

/**
 * ProvisioningStoryboard — invisible clientEntry that drives the
 * Provisioning view's step list, progress bar, and "taking longer
 * than usual" indicator from the server-supplied activeStep.
 *
 * Pre-U10: this drove a synthetic ~25s timer with seeded-random per-
 * step durations. U9 added real server-side pendingPhase signals;
 * U10 drops the timer and lets the StatusPoller's navigate-replace
 * push the new activeStep through SSR on every state change. The
 * client component is now a small DOM-sync layer: read the prop,
 * paint the matching step classes, and track wall-clock time at
 * the same step for the stuck-detection degradation.
 *
 * "Taking longer than usual" fires after STUCK_THRESHOLD_MS (60s)
 * at the same activeStep. The anchor is persisted to sessionStorage
 * keyed on sessionId so it survives:
 *   - clientEntry re-mounts triggered by StatusPoller's
 *     navigate({ history: 'replace' }) inside the same tab
 *   - tab-backgrounding — wall-clock anchor self-syncs on resume
 *
 * DOM contract — the storyboard expects these IDs inside the
 * `[data-storyboard]` card (provisioning.tsx renders them):
 *   #step-0 … #step-4   — step <li>s; classes 'done | active | pending'
 *   #bar-fill           — div, style.width drives fill
 *   [data-eta-wrap]     — wrapper hidden on stuck
 *   [data-stuck-meta]   — wrapper shown on stuck
 *   #log-cursor         — span; .blink removed on stuck
 */

export const STUCK_THRESHOLD_MS = 60_000
export const TOTAL_STEPS = 5
const TICK_INTERVAL_MS = 1_000

/**
 * Bar-fill percentage for a given activeStep. Caps at 95% so the
 * bar never sells "100% done" while we're still polling — the
 * Ready transition fully fills it via the page change.
 */
export function barFillPctForStep(activeStep: number, totalSteps = TOTAL_STEPS): number {
  if (totalSteps <= 0) return 0
  const clamped = Math.max(0, Math.min(activeStep, totalSteps - 1))
  // (clamped + 1) / totalSteps * 95 — finished steps before
  // activeStep count as complete; the bar visibly advances on each
  // server-driven phase transition.
  return Math.min(95, ((clamped + 1) / totalSteps) * 95)
}

/** Step <li> class for index `i` given the current activeStep. */
export function stepClassFor(i: number, activeStep: number): string {
  if (i < activeStep) return 'step done'
  if (i === activeStep) return 'step active'
  return 'step'
}

export const ProvisioningStoryboard = clientEntry(
  import.meta.url,
  function ProvisioningStoryboard(
    handle: Handle<{
      sessionId: string
      activeStep: number
      pendingPhase?: PendingPhase
    }>,
  ) {
    const { sessionId, activeStep } = handle.props
    const anchorKey = `openvoid:storyboard-anchor:${sessionId}`

    let timer: ReturnType<typeof setInterval> | undefined
    let degraded = false

    const readAnchor = (): { step: number; at: number } | null => {
      try {
        const raw = sessionStorage.getItem(anchorKey)
        if (!raw) return null
        const parsed = JSON.parse(raw) as { step?: number; at?: number }
        if (typeof parsed.step !== 'number' || typeof parsed.at !== 'number') return null
        return { step: parsed.step, at: parsed.at }
      } catch {
        return null
      }
    }

    const writeAnchor = (step: number, at: number): void => {
      try {
        sessionStorage.setItem(anchorKey, JSON.stringify({ step, at }))
      } catch {
        // Quota / disabled storage — non-fatal; degradation just
        // won't fire across remounts.
      }
    }

    const paintSteps = (): void => {
      for (let i = 0; i < TOTAL_STEPS; i += 1) {
        const el = document.getElementById(`step-${i}`)
        if (!el) continue
        const cls = stepClassFor(i, activeStep)
        if (el.className !== cls) el.className = cls
      }
      const barEl = document.getElementById('bar-fill')
      if (barEl) barEl.style.width = `${barFillPctForStep(activeStep)}%`
    }

    const applyDegraded = (): void => {
      if (degraded) return
      degraded = true
      const etaWrap = document.querySelector<HTMLElement>('[data-eta-wrap]')
      if (etaWrap) etaWrap.hidden = true
      const stuckMeta = document.querySelector<HTMLElement>('[data-stuck-meta]')
      if (stuckMeta) stuckMeta.hidden = false
      const barEl = document.getElementById('bar-fill')
      if (barEl) barEl.classList.add('indeterminate')
      const cursor = document.getElementById('log-cursor')
      if (cursor) cursor.classList.remove('blink')
    }

    const clearDegraded = (): void => {
      if (!degraded) return
      degraded = false
      const etaWrap = document.querySelector<HTMLElement>('[data-eta-wrap]')
      if (etaWrap) etaWrap.hidden = false
      const stuckMeta = document.querySelector<HTMLElement>('[data-stuck-meta]')
      if (stuckMeta) stuckMeta.hidden = true
      const barEl = document.getElementById('bar-fill')
      if (barEl) barEl.classList.remove('indeterminate')
    }

    const checkStuck = (): void => {
      const anchor = readAnchor()
      if (!anchor) return
      if (anchor.step !== activeStep) return
      const elapsed = Date.now() - anchor.at
      if (elapsed >= STUCK_THRESHOLD_MS) applyDegraded()
    }

    handle.signal.addEventListener('abort', () => {
      if (timer) clearInterval(timer)
    })

    handle.queueTask(() => {
      if (handle.signal.aborted) return

      // Reconcile the anchor against the current activeStep.
      // - No prior anchor, or prior step differs → fresh anchor.
      // - Same step → keep the prior `at` so stuck detection
      //   measures cumulative wall-clock since the step started.
      const prior = readAnchor()
      if (!prior || prior.step !== activeStep) {
        writeAnchor(activeStep, Date.now())
        clearDegraded()
      }

      paintSteps()
      checkStuck()
      timer = setInterval(checkStuck, TICK_INTERVAL_MS)
      wireDisclosure(handle.signal)
    })

    return () => null
  },
)

/**
 * Disclosure toggle for the synthetic log. Wires aria-expanded and
 * the `[data-open]` data attribute together. Kept inside the
 * storyboard clientEntry so we don't pay for a second entry just
 * for one click handler.
 */
function wireDisclosure(signal: AbortSignal): void {
  const button = document.querySelector<HTMLButtonElement>('[data-disclosure]')
  const log = document.getElementById('provisioning-log')
  if (!button || !log) return

  const onClick = () => {
    const open = button.getAttribute('aria-expanded') !== 'true'
    button.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) log.setAttribute('data-open', '')
    else log.removeAttribute('data-open')
    const last = button.lastChild
    if (last && last.nodeType === Node.TEXT_NODE) {
      last.textContent = open ? ' Hide live log' : ' Show live log'
    }
  }

  button.addEventListener('click', onClick, { signal })
}
