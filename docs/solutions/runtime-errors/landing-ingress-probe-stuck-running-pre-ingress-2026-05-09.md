---
title: Landing magic-moment stuck on running-pre-ingress in-cluster (nip.io resolves to pod loopback)
date: 2026-05-09
category: runtime-errors
module: landing
problem_type: runtime_error
component: tooling
symptoms:
  - "Magic-moment flow permanently displays \"Provisioning · running-pre-ingress\" and never advances to Ready"
  - "gateOnIngressReadiness HEAD probe to <sid>.agent.127.0.0.1.nip.io fails with ECONNREFUSED from inside the landing pod"
  - "Same flow works in local dev (outside kind) where 127.0.0.1.nip.io resolves to the host's ingress port"
root_cause: config_error
resolution_type: config_change
severity: high
related_components: [tooling]
tags: [landing, kubernetes, kind, nip-io, ingress, dns, loopback, magic-moment]
---

# Landing magic-moment stuck on running-pre-ingress in-cluster (nip.io resolves to pod loopback)

## Problem

The openvoid landing magic-moment flow was permanently stuck on the "Provisioning · running-pre-ingress" screen and never advanced to Ready when the landing service ran in-cluster. Its ingress-readiness probe targeted `<sid>.agent.127.0.0.1.nip.io` which, from inside the pod, resolved to the pod's own loopback rather than the kind node's host loopback where ingress-nginx is reachable.

## Symptoms

- After creating a session, the landing UI sat indefinitely on the "Provisioning · running-pre-ingress" screen.
- The Session API reported `status: Running` with both `agentUrl` and `previewUrl` populated.
- Opening the agent URL directly from the host browser worked fine.
- `kubectl exec` into the landing pod hitting `http://127.0.0.1.nip.io/` returned `wget: can't connect to remote host (127.0.0.1): Connection refused`, proving the host resolved to the pod loopback where nothing was listening.
- Local dev (`pnpm dev` on the host) worked fine — only in-cluster was permanently stuck.

## What Didn't Work

- **Probe only the agent URL, not both (commit `90b86b9`):** The original gate probed both agent and preview. Preview hits the user's app on port 3000, which doesn't exist until opencode starts it — a chicken-and-egg. Dropping preview unblocked that case but did nothing for the in-cluster failure: the agent probe still failed because `127.0.0.1.nip.io` from inside the pod resolves to the pod's own loopback regardless of which URL is being probed.
- **IPv4-first DNS resolution (commit `aa991ef`):** `setDefaultResultOrder('ipv4first')` at server startup fixed a different `ECONNREFUSED 127.0.0.1:80` symptom in local dev on macOS + Docker Desktop where Node's `verbatim` order preferred `::1` and Undici didn't fall back. Irrelevant in-cluster — the issue there was never IPv6, it was that `127.0.0.1` itself meant the wrong loopback (pod, not host).
- **(session history) Why this got past initial testing:** Phase 7 set up nip.io DNS with the `<sid>.agent.127.0.0.1.nip.io` shape and smoke-tested the ingress from the host browser via `check-ingress.sh`, where `127.0.0.1.nip.io` resolves correctly to the host loopback that kind has port-mapped to ingress-nginx. The probe was never executed from inside a pod during Phase 7. The in-cluster failure mode only surfaced once Unit 4b wired the magic-moment polling end-to-end and the landing pod started running `gateOnIngressReadiness` server-side per render.

## Solution

Add a `skip` option to the gate, default-sourced from a `LANDING_SKIP_INGRESS_PROBE` env var, and set that var on the in-cluster Deployment.

Before (`services/landing/app/utils/ingress.ts`):

```ts
export interface ProbeOptions {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
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
```

After:

```ts
function shouldSkipFromEnv(): boolean {
  return process.env.LANDING_SKIP_INGRESS_PROBE === 'true'
}

export interface ProbeOptions {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  skip?: boolean
}

export async function gateOnIngressReadiness(
  view: View,
  {
    fetch = globalThis.fetch,
    timeoutMs = PROBE_TIMEOUT_MS,
    skip = shouldSkipFromEnv(),
  }: ProbeOptions = {},
): Promise<View> {
  if (skip) return view
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
```

In-cluster Deployment (`infra/local/landing.yaml`):

```yaml
env:
  - name: PORT
    value: "3000"
  - name: OPENVOID_API_URL
    value: "http://session-api.openvoid-system.svc.cluster.local:4000"
  # In-cluster the agent URL's `127.0.0.1.nip.io` host resolves to
  # the pod's own loopback, not the host ingress, so the readiness
  # probe always fails. Skip it; trust the API's `Running` +
  # populated URLs and let the browser retry-on-click cover the rest.
  - name: LANDING_SKIP_INGRESS_PROBE
    value: "true"
```

Test coverage in `services/landing/test/utils/ingress.test.ts` adds a "skip=true returns ready unchanged, no fetch" case — `fakeFetch({})` would throw on any call, so the test passes only when skip suppresses the probe entirely.

## Why This Works

The agent URL has a public-host shape `<sid>.agent.127.0.0.1.nip.io`. nip.io resolves that to literal `127.0.0.1`. From a host browser, `127.0.0.1` is the kind cluster's host loopback, which kind has port-mapped to ingress-nginx — the URL is reachable. From inside the landing pod, `127.0.0.1` is the **pod's own loopback** in its network namespace, where nothing listens on port 80, so the probe always fails. The gate then downgrades `ready` → `provisioning(running-pre-ingress)` on every poll, forever.

Skipping the probe only when running in-cluster is the right shape because:

- The probe was always defensive against a brief race window between API `Running` and ingress-nginx programming the route. In-cluster the probe can't even physically observe the right thing, so it provides false negatives instead of useful signal.
- The R3 contract — the Session API populates `agentUrl`/`previewUrl` only after `Running` AND ingresses are created — already covers most of the race.
- The browser's retry-on-click covers the small remaining window: a user clicking "Open agent" in the rare unprogrammed slice sees one transient 404, and refresh recovers.
- Local dev (`pnpm dev` on the host, no env var) keeps the probe — `127.0.0.1.nip.io` does resolve to the host loopback there, so the gate retains its value as a guard.

## Prevention

- Treat any URL containing `127.0.0.1` / `localhost` / `::1` as host-context-dependent. If a server-side probe needs to reach a service that's also user-facing, prefer the in-cluster Service DNS name (e.g. `*.svc.cluster.local`) for the probe and reserve the public host for browser links.
- Push ingress-readiness server-side in Production-readiness Phase 9: have the Session API itself withhold `agentUrl`/`previewUrl` from its response until ingress-nginx has actually programmed the route, then delete this env-var gate entirely.
- When introducing an env-gated escape hatch, document it in three places at once (the function it gates, the Deployment manifest that sets it, and the plan/risks doc) so the next engineer can see all sides — this fix does so in `services/landing/app/utils/ingress.ts`, `infra/local/landing.yaml`, and the redesign plan §169 / §791.
- Keep an injectable-`fetch` test that asserts no fetch occurs when the gate is skipped (the `fakeFetch({})` pattern) — it makes the bypass contract executable rather than aspirational.
- (auto memory [claude]) Greenfield-K8s onboarding context: the lesson "pod loopback ≠ host loopback in kind" is worth a one-liner in any tutorial or runbook, since users coming from Docker mental models routinely conflate the two.

## Related Issues

- `docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md` — supporting precedent: cluster-fabric routing differences belong in Helm values / Deployment env, not the operator/app code. `LANDING_SKIP_INGRESS_PROBE` is exactly that pattern: app code stays unchanged across environments; the Deployment manifest carries the cluster-shape difference.
- `docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md` — §169 "Migration / Fallback Path" and §791 "Risks & Dependencies" originally framed the probe as a temporary measure with a server-side replacement targeted for Phase 9.
- Fix landed in commit `42b3667` on branch `feat/landing-redesign-unit-5-dockerfile`, merged via PR #21.
