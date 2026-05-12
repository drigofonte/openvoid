import { clientEntry, type Handle } from 'remix/ui'

/**
 * ProvisioningStoryboard — invisible clientEntry that drives the
 * Provisioning view's step list, ETA countdown, progress bar, and
 * log cursor on a single client-side timer.
 *
 * Synthetic v1: no backend signal exists yet for per-step progress.
 * The storyboard fakes a ~25-second timeline with semi-random
 * per-step durations seeded by the session id (so the same retry
 * reproduces the same timing). After 30 seconds elapsed it
 * degrades to an honest long-running display: ETA hides, bar
 * swaps to an indeterminate stripe, the active step's meta reads
 * "taking longer than usual." See plan 2026-05-12-001 for the bet.
 *
 * Elapsed is anchored to `props.sessionCreatedAt` (ISO timestamp
 * from the Session record), NOT to mount time. This survives:
 *   - clientEntry re-mounts when StatusPoller's pending →
 *     running-pre-ingress transition fires `navigate({ history:
 *     'replace' })` mid-progress — the new mount computes elapsed
 *     from the same anchor and resumes where it left off
 *   - tab backgrounding — wall-clock anchor self-syncs on resume
 *
 * Durations are computed client-side only; they are NEVER
 * serialized into SSR HTML, props, data-attributes, or inline
 * scripts. SSR emits the initial display state (step-0 active,
 * ETA 25, bar 0%) verbatim so hydration has nothing to flash.
 *
 * DOM contract — the storyboard expects these IDs inside the
 * `[data-storyboard]` card (provisioning.tsx renders them):
 *   #step-0 … #step-4   — step <li>s; classes 'done | active | pending'
 *   #eta                — text span (numeric "Ns remaining")
 *   #bar-fill           — div, style.width drives fill
 *   #log-cursor         — span with .blink class on the active step's log line
 */

const TOTAL_SECONDS = 25
const GRACE_SECONDS = 5 // degrade past TOTAL + GRACE
const BASE_DURATIONS = [3, 4, 5, 6, 7] // sums to 25; shuffled per session

export const ProvisioningStoryboard = clientEntry(
  import.meta.url,
  function ProvisioningStoryboard(
    handle: Handle<{ sessionId: string; sessionCreatedAt: string }>,
  ) {
    const { sessionId, sessionCreatedAt } = handle.props
    const startMs = parseISO(sessionCreatedAt)
    if (!Number.isFinite(startMs)) {
      // Bad timestamp — bail rather than animate against NaN.
      return () => null
    }

    const durations = seededShuffle(BASE_DURATIONS, hashString(sessionId))
    const cumulative = cumulativeSum(durations)

    let timer: ReturnType<typeof setInterval> | undefined
    let degraded = false

    const tick = () => {
      if (handle.signal.aborted) return
      const elapsed = Math.max(0, (Date.now() - startMs) / 1000)
      const stepIndex = computeStepIndex(elapsed, cumulative)
      const etaSec = Math.max(0, Math.ceil(TOTAL_SECONDS - elapsed))
      const barPct = Math.min(95, (elapsed / TOTAL_SECONDS) * 95)

      // Steps
      for (let i = 0; i < 5; i++) {
        const el = document.getElementById(`step-${i}`)
        if (!el) continue
        const cls = i < stepIndex ? 'step done' : i === stepIndex ? 'step active' : 'step'
        if (el.className !== cls) el.className = cls
      }

      // ETA + bar
      const etaEl = document.getElementById('eta')
      const barEl = document.getElementById('bar-fill')

      // Degraded state past TOTAL + GRACE
      if (!degraded && elapsed >= TOTAL_SECONDS + GRACE_SECONDS) {
        degraded = true
        const etaWrap = document.querySelector<HTMLElement>('[data-eta-wrap]')
        if (etaWrap) etaWrap.hidden = true
        if (barEl) barEl.classList.add('indeterminate')
        const stuckMeta = document.querySelector<HTMLElement>('[data-stuck-meta]')
        if (stuckMeta) stuckMeta.hidden = false
        const cursor = document.getElementById('log-cursor')
        if (cursor) cursor.classList.remove('blink')
      }

      if (!degraded) {
        if (etaEl) etaEl.textContent = String(etaSec)
        if (barEl) barEl.style.width = `${barPct}%`
      }
    }

    handle.signal.addEventListener('abort', () => {
      if (timer) clearInterval(timer)
    })

    // queueTask so the first tick lands after Remix's hydration
    // pass — the DOM IDs we query are emitted by provisioning.tsx
    // and must exist before the first selector lookup.
    handle.queueTask(() => {
      if (handle.signal.aborted) return
      tick() // sync first tick replaces SSR state with real elapsed
      timer = setInterval(tick, 250)
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
    // Update trailing text node: "Show live log" / "Hide live log".
    const last = button.lastChild
    if (last && last.nodeType === Node.TEXT_NODE) {
      last.textContent = open ? ' Hide live log' : ' Show live log'
    }
  }

  button.addEventListener('click', onClick, { signal })
}

/* ── Pure helpers (testable; no DOM, no time) ───────────────── */

function parseISO(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.NaN : t
}

/**
 * Compute step index from cumulative duration prefixes.
 *
 *   cumulative = [3, 7, 12, 18, 25]
 *   elapsed < 3   → 0
 *   elapsed < 7   → 1
 *   elapsed < 12  → 2
 *   elapsed < 18  → 3
 *   else          → 4 (plateau on last step; no overflow)
 */
export function computeStepIndex(elapsed: number, cumulative: readonly number[]): number {
  for (let i = 0; i < cumulative.length - 1; i++) {
    if (elapsed < cumulative[i]) return i
  }
  return cumulative.length - 1
}

export function cumulativeSum(durations: readonly number[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const d of durations) {
    acc += d
    out.push(acc)
  }
  return out
}

/**
 * FNV-1a 32-bit hash. Deterministic per input string; collision
 * properties don't matter — we only need a uint32 to seed an LCG.
 */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Deterministic Fisher-Yates shuffle seeded by an LCG starting at
 * `seed`. Same seed reproduces the same permutation, so the same
 * session id retries with the same per-step timing.
 */
export function seededShuffle<T>(input: readonly T[], seed: number): T[] {
  const out = [...input]
  let state = (seed || 1) >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    // LCG step (Numerical Recipes parameters; good enough here)
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = state % (i + 1)
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}
