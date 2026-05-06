import type { View } from './derive.ts'

/**
 * Ingress-readiness gate. Defends against the brief window where
 * the Session API has set `status: Running` and populated
 * `agentUrl`/`previewUrl`, but the per-session `Ingress` resource
 * is not yet programmed by ingress-nginx. In that window the URL
 * is reachable from the API's perspective but returns 404/503 to
 * the user's browser.
 *
 * **Probe only the agent URL.** The preview URL maps to the user's
 * own app on port 3000, which won't be listening until they (or
 * opencode) start a dev server. Probing it would gate the magic
 * moment on a chicken-and-egg dependency: the user can't open
 * opencode to bootstrap their preview because we're hiding the
 * agent link until the preview responds. Treat preview as a
 * best-effort link — present in the response, but not a
 * precondition for promoting to Ready.
 *
 * If the agent probe fails, downgrade `ready` → `provisioning`
 * with `pendingPhase: "running-pre-ingress"` so polling keeps
 * refreshing instead of showing a broken agent link.
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

  const agentReady = await probe(view.agentUrl, fetch, timeoutMs)

  if (agentReady) return view

  return {
    kind: 'provisioning',
    sessionId: view.sessionId,
    status: 'Running',
    pendingPhase: 'running-pre-ingress',
  }
}
