import type { View } from './derive.ts'

/**
 * Ingress-readiness gate. Defends against the brief window where
 * the Session API has set `status: Running` and populated
 * `agentUrl`/`previewUrl`, but the per-session `Ingress` resource
 * is not yet programmed by ingress-nginx. In that window the URLs
 * are reachable from the API's perspective but return 404/503 to
 * the user's browser.
 *
 * If either probe fails, downgrade `ready` → `provisioning` with
 * `pendingPhase: "running-pre-ingress"` so the polling component
 * keeps refreshing instead of showing broken links.
 *
 * `fetch` is injectable so tests can run without real HTTP.
 */

const PROBE_TIMEOUT_MS = 3000

export interface ProbeOptions {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

async function probe(
  url: string,
  fetchFn: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, { method: 'HEAD', signal: controller.signal })
    return response.ok || response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function gateOnIngressReadiness(
  view: View,
  { fetch = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS }: ProbeOptions = {},
): Promise<View> {
  if (view.kind !== 'ready') return view

  const [agentReady, previewReady] = await Promise.all([
    probe(view.agentUrl, fetch, timeoutMs),
    probe(view.previewUrl, fetch, timeoutMs),
  ])

  if (agentReady && previewReady) return view

  return {
    kind: 'provisioning',
    sessionId: view.sessionId,
    status: 'Running',
    pendingPhase: 'running-pre-ingress',
  }
}
