import type { View } from './derive.ts'

/**
 * Polling cadence for the `/sessions/:id` status frame.
 *
 *   elapsed <  30s → 1000 ms (fast, the happy path completes here)
 *   elapsed <  90s → 5000 ms (still possible, slower)
 *   elapsed >= 90s → 10000 ms (timeout territory; UI shows a hint)
 *
 * Pure function so the polling component can compute its next
 * cadence without owning the timestamps.
 */
export function pollCadenceMs(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 1000
  if (elapsedMs < 90_000) return 5000
  return 10_000
}

/**
 * `true` once the polling component can clear its interval. Per the
 * plan: Ready, Done (Stopped), and Failed are terminal — once the
 * Pod has settled into Running-with-URLs the controller's render
 * already shows the agent + preview links, and once it has Failed
 * or Stopped there is nothing to refresh. Provisioning and Stopping
 * keep polling.
 */
export function isTerminal(view: View): boolean {
  return view.kind === 'ready' || view.kind === 'done' || view.kind === 'failed'
}
