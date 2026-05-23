---
title: "feat: Deep-link agent UI past project + session pickers"
type: feat
status: active
date: 2026-05-23
deepened: 2026-05-23
---

# feat: Deep-link agent UI past project + session pickers

## Summary

Adds a deep-link URL form (`${agentUrl}/${base64('/workspace/repo')}/session/${agentSessionId}`) so users land directly inside the auto-seeded "Main" conversation when opening the agent. Session API fetches the OpenCode session ID over cluster-internal HTTP, includes it in the status-poll response as a new `agentSessionId` field, and the "Ready" state is gated on its presence — so every click gets the deep link.

---

## Problem Frame

PR #35 (auto-seed) leaves the agent pod booting with a "Main" session created and the user's prompt already running. But OpenCode's web UI lands on a project picker; the user must click `/workspace/repo`, then click "Main" from the session list before they see the work. Two clicks of friction per session, leaks internal vocabulary (the project path is implementation detail to the user), and undermines the "agent already working on it" promise that auto-seed was meant to deliver.

The deep-link URL form is established — the user provided a concrete URL during the prior conversation that the OpenCode web UI accepts:

```
http://<sid>.agent.<domain>/L3dvcmtzcGFjZS9yZXBv/session/ses_xxxx
                            └────────┬─────────┘ └──────┬──────┘
                       base64('/workspace/repo')   OpenCode session id
```

`agentUrl` and the project-path base64 are already known to the landing app (or constant). The missing piece is the OpenCode session ID, which is generated server-side by the pod's seed-agent at boot and never crosses the pod boundary today.

---

## Requirements

- R1. Clicking "Open agent" in landing lands the user inside the auto-seeded "Main" OpenCode session — no project picker, no session list visible mid-flow.
- R2. The "Ready" state in landing is only entered once the deep-link URL is fully constructible (i.e. `agentSessionId` is known).
- R3. The deep-link URL composes as `${agentUrl}/${base64('/workspace/repo')}/session/${agentSessionId}` and is the value used for the "Open agent", "Open chat", and "Copy URL" affordances in the Ready view.
- R4. Session API → pod HTTP call uses the cluster-internal Service DNS (`session-<sid-lower>.openvoid-sessions.svc.cluster.local:8080`) — never the user-facing nip.io / agent-ingress host.
- R5. Transient failures on the Session API → pod call (ECONNREFUSED during Service-DNS ramp-up, 5xx, network blips, OpenCode SPA-fallback 200s) keep the user in `Pending` rather than flapping Ready. Once `agentSessionId` has been observed for a given `(sid, podUid)` pair, it sticks for that pod's lifetime (cached).
- R6. Tests cover the contract on both sides — Session API's find/cache/gate behavior and landing's URL composition + Ready gating.
- R7. The "Main" session-title contract is hard-baked on both ends (no env knob), and import-repo pods (which never run seed-agent) are NOT subject to the new gate.

---

## Scope Boundaries

- Configurable per-app session title — "Main" stays baked in for v1.
- Cold-start / pod-boot time reduction (e.g. pre-baked image with deps) — separate workstream, explicitly out of scope per prior conversation.
- Deep-linking to a session other than "Main" — e.g. if the user manually creates more sessions later in the agent UI, those still require manual selection.
- Changing OpenCode's web UI behavior (asking it to skip the picker without a deep link).
- A new error UX for "agent pod is Running but the Main session never appeared." Current treatment (`Pending {pendingPhase}`) is sufficient — the user sees the existing provisioning screen until the seed completes.
- A graceful `opencode-server-password` Secret-rotation reload mechanism — v1 requires Session API restart after rotation, documented in the runbook.

### Deferred to Follow-Up Work

- Capture a `docs/solutions/best-practices/` learning post-merge documenting (a) the OpenCode SPA-fallback-200 handling pattern Session API uses here, and (b) the base64 / deep-link URL encoding form (no prior learning in the repo covers either).
- Per-sid negative-result TTL on `findMainSessionId` to dampen the cache-miss fan-out during the seed-create window. Probably fine at v1 scale; revisit if Session API CPU/network gets noisy under load.

---

## Context & Research

### Relevant Code and Patterns

- **Status response build site:** `services/session-api/src/routes/sessions.ts:310-354` — the `GET /sessions/:id` handler. The `Running` branch at lines 340-343 is the exact site to populate `agentSessionId` and where the new gating logic belongs (downgrades to `Pending` when ID isn't yet readable). Keeps `derivePodSessionState` (`services/session-api/src/k8s/pod-status.ts`) pure as a snapshot-over-`V1Pod` function.
- **Auth surface (already loaded):** `loadOpencodeAuthHeader` (`services/session-api/src/k8s/client.ts:690-720`) reads the `opencode-server-password` Secret at boot and caches the pre-formatted `Basic <…>` header on `K8sSessionOps.authHeaderValue` (`client.ts:722-727`). No new Secret read needed — plumb the existing value to the new helper.
- **Cluster networking:** `buildSessionService` (`client.ts:558-593`) creates `ClusterIP` Service `session-<sid-lower>` in namespace `openvoid-sessions`. Constants: `SESSION_NAMESPACE` (`client.ts:12`), `OPENCODE_AGENT_PORT=8080` (`client.ts:116`), `sidLower` casing rule (`client.ts:226-228`).
- **Existing annotation pattern:** `REPO_ANNOTATION`, `BRANCH_ANNOTATION`, `CREATED_AT_ANNOTATION` (`client.ts:17-19`) are read off `pod.metadata.annotations` in the route handler. The new `NEW_APP_ANNOTATION` follows the same shape (KD9).
- **Title contract:** seed-agent writes `title="Main"` (default from `infra/images/opencode/seed-agent.sh`, env `OPENVOID_SEED_SESSION_TITLE`). The same env is currently in `SEED_PASSTHROUGH_ENV_NAMES` (`client.ts:518-525`) — an operator override would silently break the deep-link contract (see KD3 below).
- **Dependency-injection pattern for testability:** `sessionsRouter(deps)` (`routes/sessions.ts:114-124`) injects `SessionOps`. Mirror this for the new HTTP helper — inject `fetch` so vitest can substitute a fake. Mock pattern at `test/routes.sessions.test.ts:49-62`.
- **Canonical fetch shape (landing-side reference):** `services/landing/app/utils/ingress.ts:53-68` — plain `fetch` with `AbortController` + timeout. session-api has no existing outbound HTTP — match this shape.
- **Shared types:** `packages/protocol/main.tsp` (TypeSpec source) → `packages/protocol/generated/` (TS types). Session model at `main.tsp:78-108`; `PendingPhase` enum is in the same file. **Add `agentSessionId?: string` to Session AND `AwaitingAgentSession` to PendingPhase here first**, regenerate, both sides consume.
- **Landing status consumption:**
  - `services/landing/app/actions/api/sessions-status/controller.tsx:25-32, 65-70` — `StatusResponse` shape + `ready` branch.
  - `services/landing/app/actions/sessions/client/status-poller.tsx:29-36` — `signature(...)` join must include `agentSessionId` so the poller detects when it arrives. Also `status-poller.tsx:64-69` builds an initial signature from `initial*` props — `initialAgentSessionId` is the new prop.
  - `services/landing/app/utils/derive.ts:103-161` — pure `View` derivation. `ready` arm at 121-128 currently requires `agentUrl && previewUrl`; must also require `agentSessionId`. `ACTIVE_STEP` map needs the new `awaiting-agent-session` phase entry.
  - `services/landing/app/actions/sessions/page.tsx:75-83, 124-127` — `StatusPoller` initial-props call site; `phaseAnnouncement` switch where the new sr-only copy lands.
  - `services/landing/app/actions/sessions/components/ready.tsx:48-52, 132-135, 198-211, 257-269` — `ReadyProps`, `DuoProps`, the `<a href>` + `CopyButton` consumption surfaces (Duo/ChatCard, OpenLinkShortcuts). No iframe — both affordances are plain links.
- **Test patterns:**
  - session-api: vitest + `vi.fn` mock `SessionOps` (`test/routes.sessions.test.ts:49-62`); `vi.stubEnv` / `vi.unstubAllEnvs`. For the new outbound call, inject `fetch` and pass a `vi.fn()` returning a fake `Response`.
  - landing: `services/landing/test/utils/ingress.test.ts:16-26` — `fakeFetch({url: Response | Error})` helper. No landing-side fetch needed for this plan; existing `derive.test.ts` pattern covers gating.
- **AGENTS.md guidance applied:** Conventional commits, no comments unless WHY is non-obvious, reference files inline as `path:line`, run `pnpm --filter @openvoid/<pkg> test` + typecheck after any change, no CLAUDE.md exists.

### Institutional Learnings

- **`docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md`** — direct precedent. Establishes the "in-cluster callers must use `*.svc.cluster.local`, never the user-facing host" rule (R4). Also establishes the pattern of *withholding a field from the API response until the backend is actually ready* — the exact "Ready gates on session ID known" model this plan uses. **Critical race note:** Service DNS resolves before endpoints populate; expect transient ECONNREFUSED / NXDOMAIN during the gap. The same learning warns: do NOT downgrade status on a single failed probe — that's the false-negative trap landing's ingress probe hit. Hence R5.
- **`docs/solutions/best-practices/per-session-pod-pnpm-dev-boot-traps-2026-05-22.md`** — PR #34/#35 hot-stove. Two relevant items: (a) existing readinessProbe targets port 3000 (Vite), not 8080 (OpenCode) — the new "Ready when session ID known" gate is a *second* readiness signal composed on top of the probe, not a replacement. (b) Trap 4 reinforces the "never embed creds in URL, never log them" rule for the new HTTP helper.
- **`docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md`** — adjacent; reinforces in-cluster Service DNS as the cluster-neutral primitive.

### External References

None for this plan — OpenCode's deep-link URL form was established in-conversation from a user-provided live URL and prior web research on OpenCode's web UI routing. The 2026-05-02 endpoint spike (`docs/spikes/2026-05-02-opencode-endpoints.md`) is the existing source for endpoint shapes, the SPA-fallback-returns-200 quirk, and the `time.created` field used for collision-resistant matching (KD10).

---

## Key Technical Decisions

- **KD1. Gate at the route handler, not in `derivePodSessionState`.** `derivePodSessionState` is a pure function over a `V1Pod` snapshot; adding an HTTP call would break that purity. The route handler calls `derivePodSessionState`, and if the result is `Running` AND `pod.metadata.annotations[NEW_APP_ANNOTATION] === 'true'`, calls the new `findMainSessionId(sid, pod)` helper; if the helper returns `undefined`, the handler downgrades to `{status: "Pending", pendingPhase: "awaiting-agent-session"}` with the URL fields omitted.

  **Rejected alternative: best-effort + root-URL fallback.** An earlier framing had the deep-link as additive: when `agentSessionId` is known use it; otherwise fall back to the root `agentUrl` (today's behavior with the picker). Picker-skip would land for late-clickers; early-clickers would see today's UX. We rejected this because (a) it makes "Open agent" land in two different places depending on timing — the inconsistency itself is friction worth avoiding, and (b) the gate's downside (slightly later Ready notification) is bounded by the cache being sticky-once-found; the fallback's downside (any deep-link path failure silently degrades the UX) compounds over time as new failure modes accumulate.
- **KD2. Cache `(agentSessionId, podUid)` per K8s sessionId on `K8sSessionOps`.** Cache shape: `Map<sid, {agentSessionId: string, podUid: string}>`. The OpenCode session ID is stable for a *pod's* lifetime, but the K8s sid can be reused if a pod is manually deleted and recreated. Storing `podUid` alongside lets each cache lookup verify the entry belongs to the current pod (compare against `pod.metadata.uid`) and invalidate-and-refetch on mismatch. Defends against operator manual `kubectl delete pod` + recreate AND any future controller-based pod-management pattern that could preserve the sid.
- **KD3. Drop `OPENVOID_SEED_SESSION_TITLE` from `SEED_PASSTHROUGH_ENV_NAMES` AND hardcode `SESSION_TITLE="Main"` in `seed-agent.sh`.** With "Main" baked in on both ends, no env knob remains for an operator to drift. Dropping the passthrough alone would leave three drift paths open (Dockerfile `ENV` line, `kubectl set env` against a running pod's agent container, future PR re-adding to passthrough). Hardcoding the constant in seed-agent.sh closes all three. A content-guard test in `routes.sessions.test.ts` asserts the literal string is present in the script — regression-protects the lockstep with Session API's `MAIN_SESSION_TITLE`.
- **KD4. Inject `fetch` as a dependency on the new helper.** Matches the existing `sessionsRouter(deps)` DI pattern (`routes/sessions.ts:114-124`). Vitest substitutes a fake `Response` in tests; the production constructor uses Node 22's native `fetch`.
- **KD5. Validate response shape before parsing.** Per the 2026-05-02 spike, OpenCode's HTTP server returns the SPA HTML shell with status 200 for any unknown path. The new helper checks `Content-Type: application/json` (or attempts a typed JSON parse and rejects on shape mismatch) before iterating for the title match. A 200 with HTML is treated as "not yet readable," same as a 5xx — transient, no cache write.
- **KD6. The "Main" constant lives in `services/session-api/src/k8s/client.ts` alongside `OPENCODE_*` constants, exported as `MAIN_SESSION_TITLE`.** A comment documents the lockstep with `infra/images/opencode/seed-agent.sh`'s hardcoded `SESSION_TITLE` (KD3). This mirrors the existing `SEED_PASSTHROUGH_ENV_NAMES` precedent for "small constant kept in sync across files."
- **KD7. The deep-link URL composer lives in a single landing-side helper** (`services/landing/app/utils/agent-url.ts`). The base64-encoded project-path constant (`AGENT_PROJECT_PATH_B64 = 'L3dvcmtzcGFjZS9yZXBv'`) lives there too, with a comment cross-referencing the `WORKDIR /workspace/repo` in `infra/images/opencode/Dockerfile`. Centralizes the URL shape so any future change is a one-file edit.
- **KD8. Introduce a new `pendingPhase` value `awaiting-agent-session`.** Reusing `running-pre-ingress` was considered to avoid rippling through landing's phase narration, but that phase is documented in `pod-status.ts:113` as client-derived-only (ingress-nginx hasn't programmed the host) — the server has never emitted it. Reusing it would silently conflate two distinct conditions and the screen-reader copy `"Almost ready — programming routes"` would fire misleadingly during the seed wait. The new phase costs one enum entry + one `ACTIVE_STEP` map entry + one `phaseAnnouncement` switch arm (~10 LOC total) and preserves accurate operator/sr-only narration.
- **KD9. Distinguish new-app pods via `NEW_APP_ANNOTATION` on the pod manifest.** Export `NEW_APP_ANNOTATION = 'openvoid.io/new-app'` from `client.ts` alongside `REPO_ANNOTATION`/`BRANCH_ANNOTATION`. Set the annotation value to `"true"` in `buildSessionPodManifest` when `spec.isNewApp` is true; import-repo pods omit it. The route handler reads `pod.metadata?.annotations?.[NEW_APP_ANNOTATION] === 'true'` before calling `findMainSessionId` — import-repo pods skip the call and continue to enter `Running` as today. Annotations are the right primitive here (non-selectable metadata, same shape as existing annotations) rather than labels (which carry K8s-selector semantics this flag doesn't need) or runtime env-scanning of the agent container (introduces a pattern not used elsewhere in the handler).
- **KD10. Match by `title === "Main"` AND select the earliest by `time.created`.** Among all sessions matching the title, prefer the one with the smallest `time.created` (per the 2026-05-02 spike: `time.created` is Unix ms, present on every session in `GET /session`). seed-agent always runs at pod boot, well before any user can interact with the agent UI — its session is provably first by creation time. Zero added complexity (the field is already returned), defends deterministically against title-collision poisoning (a user reaching the agent UI via the raw ingress URL during the pre-seed window and creating another "Main" session), and doesn't depend on OpenCode's `GET /session` ordering guarantees.

---

## Alternative Approaches Considered

| Approach | Why rejected |
|---|---|
| **A. Session API queries the pod over cluster-internal HTTP** (chosen) | The auth surface is already loaded (`K8sSessionOps.authHeaderValue`); cluster Service DNS exists; landing already polls Session API for status, so the new field rides the existing pipeline. Adds an outbound HTTP egress from Session API — a meaningful architecture inflection (first such call from the service), but contained to a single helper, cluster-internal, and absorbable by the existing poll-loop's retry semantics. |
| **B. seed-agent writes session ID to a file in `/workspace`; Session API reads via `kubectl exec`** | Removes the cross-namespace HTTP egress and the auth-header surface from Session API entirely. But `kubectl exec` from a Node process is awkward (no first-class helper in `@kubernetes/client-node`), introduces a new RBAC requirement (exec subresource on session pods), and the file-read race (seed mid-write vs. Session API mid-read) needs its own coordination. The "session ID in URL on the response" outcome is identical; we picked HTTP for the lower complexity at the call site and the cleaner DI/test story. |
| **C. Session API pre-generates the session ID and passes it via env; seed-agent uses the supplied ID** | Eliminates the back-channel entirely — Session API would know the ID at pod-create time. Blocked: per the 2026-05-02 spike, `POST /session` returns a server-generated `.id` and OpenCode's API does not accept caller-supplied session IDs. Not adoptable without an upstream OpenCode change. |

---

## Open Questions

### Resolved During Planning

- **Where to make the HTTP call from?** Session API, not landing. Session API already mounts the OpenCode password Secret; landing has no Basic auth surface to the agent.
- **What hostname?** `session-<sid-lower>.openvoid-sessions.svc.cluster.local:8080` — cluster-internal Service DNS. R4 / institutional learning.
- **What if the operator overrode the seed title?** Don't allow it — drop the env from passthrough AND hardcode in seed-agent (KD3).
- **Polling cadence?** Reuse landing's existing poll cadence (`services/landing/app/utils/poll.ts`, 1s → 5s → 10s). No new schedule.
- **Race with `pnpm install`/build time?** Same race as the existing readinessProbe — pod stays in `Pending` until probe passes; this plan composes on top, not replaces.
- **How to distinguish new-app from import-repo pods at the route handler?** New `NEW_APP_ANNOTATION` on the pod manifest, read off `pod.metadata.annotations` (KD9).
- **Cache invalidation on pod-recreate-with-sid-preserved?** Track `podUid` alongside `agentSessionId`; invalidate on UID mismatch (KD2).
- **Which `pendingPhase` value during the seed wait?** New `awaiting-agent-session` (KD8).
- **What if a user creates a competing "Main" session in the pre-seed window?** Match by `title === "Main"` AND `min(time.created)` (KD10).
- **Best-effort fallback to root-URL when `agentSessionId` is missing?** Rejected — gating delivers consistent landing behavior (see KD1's rejected-alternative note).

### Deferred to Implementation

- **Whether the new helper is a method on `K8sSessionOps` or a free function with injected `fetch`.** Both are reasonable; the deciding factor is whether the cache (KD2) is per-instance state (→ method) or module-scoped (→ free function). Implementer picks based on whether the existing `K8sSessionOps` already has cache-style state. The test file lines targeted by U2 stay the same either way.
- **Timeout on the Session API → pod fetch.** Pick a value short enough not to lag the status-poll (single-digit seconds; the poll cadence absorbs retries). Implementer chooses after seeing the existing `AbortController` timeout in `services/landing/app/utils/ingress.ts:53-68`.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    autonumber
    participant L as Landing<br/>(status poller)
    participant API as Session API<br/>(routes/sessions.ts)
    participant Cache as K8sSessionOps<br/>(sid → {id, podUid})
    participant K8s as K8s API
    participant Pod as Agent pod<br/>(via Service DNS)
    participant OC as opencode serve<br/>(in pod, :8080)

    L->>API: GET /sessions/{sid}
    API->>K8s: getSessionPod(sid)
    K8s-->>API: V1Pod {phase, metadata}
    Note over API: derivePodSessionState → "Running"<br/>check annotations[NEW_APP_ANNOTATION]

    alt import-repo pod (annotation absent)
        API-->>L: 200 { status:"Running", agentUrl, previewUrl }<br/>(no agentSessionId — today's behavior)
    else new-app pod (annotation === "true")
        API->>Cache: lookup(sid) — entry exists AND podUid matches?
        alt cache hit (podUid matches)
            Cache-->>API: { agentSessionId, podUid }
        else cache miss OR podUid mismatch
            Note over API,Cache: drop stale entry if podUid mismatched
            API->>Pod: GET http://session-{sid}.openvoid-sessions.svc.cluster.local:8080/session<br/>Authorization: Basic <header>
            alt success + valid JSON array
                Pod->>OC: GET /session (loopback)
                OC-->>Pod: [{title, id, time:{created}}, …]
                Pod-->>API: 200 + JSON
                Note over API: filter title==="Main" (KD6)<br/>pick min(time.created) (KD10)<br/>validate Content-Type (KD5)
                API->>Cache: set(sid, {id, podUid})
            else 401 (Secret rotated; permanent until restart)
                Pod--xAPI: 401
                Note over API: log warning (no header value)<br/>do NOT cache<br/>return undefined
            else transient (ECONNREFUSED, 5xx, SPA-fallback HTML, abort)
                Pod--xAPI: error / non-JSON / 5xx
                Note over API: do NOT cache<br/>do NOT log auth header<br/>return undefined
            end
        end

        alt agentSessionId resolved
            API-->>L: 200 { status:"Running", agentUrl, previewUrl, agentSessionId }
            Note over L: derive.ts → kind:"ready"<br/>agent-url.ts builds deep-link
        else still missing
            API-->>L: 200 { status:"Pending", pendingPhase:"awaiting-agent-session" }
            Note over L: stays in provisioning view<br/>sr-only: "Starting up your coding agent"<br/>poller continues (1s/5s/10s)
        end
    end
```

---

## Implementation Units

### U1. Add `agentSessionId` field + `AwaitingAgentSession` pending-phase to the shared `Session` contract

**Goal:** Extend the canonical types so both services share one shape for the new field and the new phase.

**Requirements:** R3, R6

**Dependencies:** None

**Files:**
- Modify: `packages/protocol/main.tsp`
- Modify (regenerated): `packages/protocol/generated/` (run `pnpm --filter @openvoid/protocol generate`)

**Approach:**
- Add `agentSessionId?: string` to the `Session` model at `main.tsp:78-108`. Optional — present only when the pod is Running, isNewApp, and the Main session has been observed.
- Add `AwaitingAgentSession` (string serialized form: `"awaiting-agent-session"`) to the `PendingPhase` enum in the same file. The value joins the existing phases used for the provisioning state machine.
- Document inline that `agentSessionId` is the OpenCode session ID assigned to the auto-seeded "Main" session, and that `awaiting-agent-session` covers the "pod Running, isNewApp, but Main session not yet readable" interval.
- Regenerate TS types. The Session field is additive (optional) — non-breaking. The enum addition is additive — consumers handle new phases by falling through to the existing default narration.

**Test scenarios:**
- Test expectation: none — pure type-surface change. Verification is downstream typecheck.

**Verification:**
- `pnpm --filter @openvoid/protocol generate` succeeds.
- Repo-wide `pnpm typecheck` still passes (additive optional field + additive enum value are non-breaking).

---

### U2. Session API: `findMainSessionId` helper with UID-tracked cache, collision-resistant matching, and transient tolerance

**Goal:** Add the cluster-internal HTTP call that finds the OpenCode "Main" session ID, caches it per-pod (UID-keyed), and degrades cleanly on every documented failure mode.

**Requirements:** R4, R5, R6, R7

**Dependencies:** None (independent of U1 — works on plain strings)

**Files:**
- Modify: `services/session-api/src/k8s/client.ts` (new helper, `MAIN_SESSION_TITLE` constant, cache state on `K8sSessionOps`)
- Test: `services/session-api/test/routes.sessions.test.ts` (new `describe` block) — or split into a new test file if the existing one is getting large; existing convention is one shared file.

**Approach:**
- Export `MAIN_SESSION_TITLE = "Main"` alongside the other `OPENCODE_*` constants in `client.ts`. Comment notes the lockstep with `infra/images/opencode/seed-agent.sh`'s hardcoded `SESSION_TITLE` (KD3, KD6).
- Add `findMainSessionId(sid: string, pod: V1Pod): Promise<string | undefined>` — either a method on `K8sSessionOps` (preferred if it owns the cache) or a free function with injected `fetch`, `authHeaderValue`, and a closure over the cache. Deferred decision in Open Questions.
- Cache shape: `Map<sid, {agentSessionId: string, podUid: string}>` (KD2). On each call, look up by `sid`. If found AND the cached `podUid === pod.metadata?.uid`, return immediately. If found but `podUid` mismatches, `delete(sid)` and proceed to fetch. If not found, proceed to fetch.
- URL: `http://session-<sidLower>.${SESSION_NAMESPACE}.svc.cluster.local:${OPENCODE_AGENT_PORT}/session`. Reuse existing `podName()` casing rule (`client.ts:226-228`).
- Headers: `Authorization: ${authHeaderValue}`, `Accept: application/json`. **`authHeaderValue` must stay scoped to the fetch invocation** — do not assign it to wider scopes that future structured loggers could serialize. The error-catch block logs only `{sid, error: err.message}`; never the request config object, never the header value (F3).
- Use `AbortController` with a short timeout (single-digit seconds — implementer picks per landing reference at `services/landing/app/utils/ingress.ts:53-68`).
- Response handling:
  - Network error (ECONNREFUSED, NXDOMAIN, abort/timeout) → return `undefined`, do not cache, log sanitized message only.
  - Status 401 → distinct warning log: `"Authorization rejected by agent pod (sid=${sid}); opencode-server-password may be stale — restart Session API after rotation"`. No header value in the log. Return `undefined`, do not cache. (F4 — converts the silent indefinite hang into an observable failure with a recovery path.)
  - Status non-2xx (other 4xx, 5xx) → return `undefined`, do not cache.
  - Status 2xx but `Content-Type` not JSON OR body doesn't parse as JSON array → return `undefined` (SPA-fallback defense, KD5).
  - Status 2xx + valid JSON array → filter for `.title === MAIN_SESSION_TITLE`, sort filtered matches by `.time.created` ascending, take `.id` of the smallest (KD10). If no match, return `undefined` (no cache write). On match, write `cache.set(sid, {agentSessionId: id, podUid: pod.metadata.uid})`.
- Provide a clear-cache hook for session deletion (call from `deleteSessionResources` if natural, or leave for v1.5 — single-replica process, drift is bounded by restart).

**Patterns to follow:**
- DI shape: `sessionsRouter(deps)` (`services/session-api/src/routes/sessions.ts:114-124`) — inject the dependency, mock in tests.
- Fetch shape: `services/landing/app/utils/ingress.ts:53-68` (`AbortController` + `setTimeout(...).unref()`).
- Auth surface: `loadOpencodeAuthHeader` (`client.ts:690-720`), `K8sSessionOps.authHeaderValue` (`client.ts:722-727`).
- Test mocking: `vi.fn` substitutes for the injected dependency (`test/routes.sessions.test.ts:49-62`).

**Test scenarios:**
- Happy path: pod responds 200 + JSON array containing `[{title:"Main", id:"ses_abc", time:{created:1000}}]` → helper returns `"ses_abc"`, second call hits cache (fetch invoked once across two calls).
- Happy path: array contains multiple sessions, only one titled "Main" → returns that one's `id`.
- Edge case (D4): array contains two `"Main"` sessions with different `time.created` → returns the `id` of the one with the smaller `time.created`, regardless of array order. Verifies KD10 collision-resistant matching.
- Edge case: array contains no "Main" session → returns `undefined`, cache not written, next call re-fetches.
- Edge case: empty array → returns `undefined`, cache not written.
- Edge case: cache hit, same `podUid` on the next call → second call does NOT re-fetch (mock fetch confirms one call across N invocations).
- Edge case (D2): cache hit BUT current pod has a different `metadata.uid` → cache entry dropped, fetch issued, new entry written with the new `podUid`. Verifies KD2 pod-recreate invalidation.
- Error path: fetch rejects with `TypeError` (network error) → returns `undefined`, no cache write, no crash, auth header value not in any thrown error or logged message.
- Error path: response 500 → returns `undefined`, no cache write.
- Error path (F4): response 401 → returns `undefined`, no cache write, warning log fires with `sid` but NOT the auth header value or full request config. The expected operator-facing message ("opencode-server-password may be stale — restart Session API after rotation") appears in the log.
- Error path: response 200 + `Content-Type: text/html` (SPA fallback) → returns `undefined`, no cache write (KD5).
- Error path: response 200 + invalid JSON body → returns `undefined`, no cache write.
- Error path: response 200 + JSON object instead of array → returns `undefined`, no cache write.
- Edge case (F3): abort fires (timeout exceeded) → returns `undefined`, no cache write, auth header value not in any error/log path (asserted with `vi.spyOn` on console + on the thrown error).
- Integration: URL format matches `session-<sid>.openvoid-sessions.svc.cluster.local:8080/session` exactly, sid is lower-cased (assert against a known mixed-case input).
- Integration: Authorization header matches the value returned by `loadOpencodeAuthHeader` (assert the header value passed to the injected fetch).

**Verification:**
- All new tests pass; `pnpm --filter @openvoid/session-api test` green.
- Typecheck clean.

---

### U3. Session API: annotation-gated `findMainSessionId` wire-in + drop title from passthrough + hardcode `"Main"` in seed-agent

**Goal:** Wire `findMainSessionId` into `GET /sessions/:id` behind the new-app annotation, downgrade to `Pending` (with the new phase) when not yet found, and close all title-drift surfaces.

**Requirements:** R1, R2, R3, R5, R6, R7

**Dependencies:** U1, U2

**Files:**
- Modify: `services/session-api/src/k8s/client.ts`
  - Add `NEW_APP_ANNOTATION = 'openvoid.io/new-app'` constant export alongside `REPO_ANNOTATION`/`BRANCH_ANNOTATION` (lines 17-19) (KD9).
  - In `buildSessionPodManifest`, when `spec.isNewApp` is true, set `annotations[NEW_APP_ANNOTATION] = 'true'`. Import-repo pods omit the annotation entirely.
  - Remove `OPENVOID_SEED_SESSION_TITLE` from `SEED_PASSTHROUGH_ENV_NAMES` at lines 518-525. Update the comment block at `client.ts:509-517` to mention KD3 (the title is now a baked-in contract enforced on both sides).
- Modify: `services/session-api/src/routes/sessions.ts` (the `Running` branch at lines 340-343 — gate, agentSessionId population, and downgrade-to-`Pending` all live inside this block; the surrounding handler at lines 310-354 is the call-site context).
- Modify: `infra/images/opencode/seed-agent.sh` — hardcode `SESSION_TITLE="Main"` (drop the `${OPENVOID_SEED_SESSION_TITLE:-Main}` env read entirely) (F6). Update the header comment / env table to reflect that the title is no longer a configurable knob.
- Modify: `infra/images/opencode/README.md` "Seed-on-boot" env-knobs table — strike the `OPENVOID_SEED_SESSION_TITLE` row entirely.
- Modify: `docs/runbooks/platform-github-org-setup.md` "seed-on-boot not firing" — re-check the diagnostic rows for any reference to the title env.
- Test: `services/session-api/test/routes.sessions.test.ts`

**Approach:**
- In `routes/sessions.ts`, after `derivePodSessionState(pod)` returns `{status:"Running"}` and before the `agentUrl`/`previewUrl` population block (lines 340-343):
  - Read `const isNewApp = pod.metadata?.annotations?.[NEW_APP_ANNOTATION] === 'true'`.
  - If `isNewApp` is false (import-repo), skip `findMainSessionId` entirely; populate `agentUrl`/`previewUrl` as today; do NOT include `agentSessionId` in the response.
  - If `isNewApp` is true, call `findMainSessionId(sid, pod)`.
    - If `undefined`, set `session.status = "Pending"` with `session.pendingPhase = "awaiting-agent-session"` — do NOT include `agentUrl`/`previewUrl`/`agentSessionId` in the response.
    - If a string, set `session.agentSessionId = ` the value, then populate `agentUrl` / `previewUrl` as today.
- Remove `OPENVOID_SEED_SESSION_TITLE` from `SEED_PASSTHROUGH_ENV_NAMES`. Update the comment block at `client.ts:509-517` to mention KD3.
- Update the corresponding passthrough tests in `routes.sessions.test.ts` (around lines 716-781) to assert the env is NOT forwarded.
- In `seed-agent.sh`, replace `SESSION_TITLE="${OPENVOID_SEED_SESSION_TITLE:-Main}"` with `SESSION_TITLE="Main"`. Remove the `OPENVOID_SEED_SESSION_TITLE` line from the header's env-table comment.
- Update `infra/images/opencode/README.md` "Seed-on-boot" env-knobs table to drop the title row.

**Patterns to follow:**
- The `Running`-branch URL-population block at `routes/sessions.ts:340-343` already establishes the "field-only-when-ready" pattern. Mirror it for `agentSessionId`.
- Annotation read pattern: existing `REPO_ANNOTATION` / `BRANCH_ANNOTATION` reads in the same handler.
- `routes.sessions.test.ts:768-780` (the `enumerate-not-prefix-scan` test) is the existing convention for asserting "this env name is NOT forwarded."

**Test scenarios:**
- Integration: pod=Running, annotation `openvoid.io/new-app=true`, `findMainSessionId` returns `"ses_x"` → response has `{status:"Running", agentUrl, previewUrl, agentSessionId:"ses_x"}`.
- Integration: pod=Running, annotation `openvoid.io/new-app=true`, `findMainSessionId` returns `undefined` → response has `{status:"Pending", pendingPhase:"awaiting-agent-session"}` with no URL fields and no `agentSessionId`. Verifies R2 + the new phase value (KD8).
- Integration (D1 regression): pod=Running, annotation absent (import-repo) → `findMainSessionId` is NOT called (mock fetch confirms zero invocations); response has `{status:"Running", agentUrl, previewUrl}` without `agentSessionId`. Verifies R7 + KD9.
- Integration: pod=Pending (phase still Pending) → `findMainSessionId` is NOT called (regression guard against a wasted HTTP per poll).
- Integration: pod=Failed → `findMainSessionId` is NOT called.
- Integration: two consecutive Running polls on a new-app pod → `findMainSessionId` invoked once (cache hit on second; mock fetch confirms one call).
- Integration: status sequence pod=Running new-app, first call returns undefined, second returns `"ses_x"` → first response is `Pending` with `awaiting-agent-session`, second response is `Running` with `agentSessionId` set. Verifies R5 (sticky-once-found behavior emerges from KD2 cache).
- Manifest test: `buildSessionPodManifest({isNewApp: true, ...})` produces a pod whose `metadata.annotations[NEW_APP_ANNOTATION] === 'true'`.
- Manifest test: `buildSessionPodManifest({isNewApp: false, ...})` produces a pod with NO `NEW_APP_ANNOTATION` key on `metadata.annotations`.
- Regression guard: `SEED_PASSTHROUGH_ENV_NAMES` no longer contains `OPENVOID_SEED_SESSION_TITLE` — setting the env on the Session API process must NOT propagate to the manifest. (Mirrors the `enumerate-not-prefix-scan` shape at `routes.sessions.test.ts:768-780`.)
- Content-guard test on `seed-agent.sh` (matches the existing content-guard pattern in `routes.sessions.test.ts`'s seed-agent describe): the file contains the literal `SESSION_TITLE="Main"` and does NOT contain `OPENVOID_SEED_SESSION_TITLE`. Locks the hardcoded contract in place against accidental regression (F6).

**Verification:**
- `pnpm --filter @openvoid/session-api test` green.
- Typecheck clean.
- Manual check on running Tilt cluster (deferred to PR test plan, not part of this unit's "done").

---

### U4. Landing: extend `StatusResponse`, `View`, poller signature, and pending-phase narration

**Goal:** Plumb `agentSessionId` + the new `awaiting-agent-session` phase through landing's status pipeline; gate `ready` view on `agentSessionId`; render accurate sr-only narration during the new wait.

**Requirements:** R2, R6

**Dependencies:** U1 (regenerated protocol types)

**Files:**
- Modify: `services/landing/app/actions/api/sessions-status/controller.tsx` (`StatusResponse` shape at 25-32, `ready` branch at 65-70)
- Modify: `services/landing/app/utils/derive.ts` (`View` union at 38-57, `ready` arm at 121-128, `ACTIVE_STEP` map)
- Modify: `services/landing/app/actions/sessions/client/status-poller.tsx` (handle prop type, initial-signature seed at 64-69, `signature(...)` at 29-36)
- Modify: `services/landing/app/actions/sessions/page.tsx` (StatusPoller call site at 75-83 — pass `initialAgentSessionId`; `phaseAnnouncement` switch at 124-127 — add `awaiting-agent-session` arm)
- Test: `services/landing/test/utils/derive.test.ts`

**Approach:**
- `StatusResponse` adds `agentSessionId?: string`. Populated in the `ready` branch only when present on the upstream `Session`.
- `View`'s `ready` variant adds `agentSessionId: string` (required — only present when fully ready, mirrors `agentUrl`/`previewUrl`).
- `derive.ts` `ready` arm (lines 121-128) becomes: `if (session.agentUrl && session.previewUrl && session.agentSessionId)` → `kind:'ready'` with all three; otherwise stay in the existing provisioning fall-through.
- `derive.ts` `ACTIVE_STEP` map gains `'awaiting-agent-session': 4` (alongside `running-pre-ingress`) — the new phase is a sibling step in the provisioning progression.
- `status-poller.tsx` `signature(...)` adds `payload.agentSessionId ?? ''` so the poller detects the transition from absent → present and triggers a re-render at the right tick.
- **Initial-signature seed must include `agentSessionId` too.** `status-poller.tsx` builds its `lastSignature` at component-mount time from `handle.props.initial*` values (currently `initialKind`, `initialPendingPhase`, `initialAgentUrl`, `initialPreviewUrl`). Add an `initialAgentSessionId: string | null` to the handle's prop type and include it in the initial-signature join, otherwise an SSR-ready page (agentSessionId already present at mount) will see signature drift on the first poll tick and trigger a spurious navigate.
- `page.tsx` (lines 75-83) threads `initialAgentSessionId={view.kind === 'ready' ? view.agentSessionId : null}` into `StatusPoller`, mirroring the existing `initialAgentUrl`/`initialPreviewUrl` shape.
- `page.tsx` (lines 124-127) `phaseAnnouncement` switch adds an arm for `'awaiting-agent-session'` → `'Starting up your coding agent'` (or similar — copy chosen to be accurate to the underlying wait). Leaves the existing `'running-pre-ingress'` → `'Almost ready — programming routes'` arm untouched.

**Patterns to follow:**
- `derive.test.ts:41-68` for the existing Running-with-only-agentUrl-stays-provisioning pattern — clone for the analogous "Running with only `agentSessionId` missing" case.
- `page.tsx`'s existing `phaseAnnouncement` switch shape for the new arm.

**Test scenarios:**
- Happy path: `{status:'Running', agentUrl, previewUrl, agentSessionId:'ses_x'}` → `kind:'ready'` view with `agentSessionId` set.
- Edge case: `{status:'Running', agentUrl, previewUrl}` (no `agentSessionId`) → stays in provisioning. Verifies R2.
- Edge case: `{status:'Running', agentUrl, agentSessionId:'ses_x'}` (no `previewUrl`) → stays in provisioning (today's behavior preserved).
- Edge case: `{status:'Pending', pendingPhase:'awaiting-agent-session'}` → `kind:'pending'` with `pendingPhase: 'awaiting-agent-session'`; the `ACTIVE_STEP` lookup returns 4.
- Edge case: `{status:'Pending', pendingPhase}` (any phase) → `kind:'pending'` regardless of any `agentSessionId` presence (defensive — Pending should never produce ready).
- Integration: poller signature changes when `agentSessionId` arrives mid-poll (signature for `(Running, agentUrl, previewUrl, undefined)` ≠ signature for `(Running, agentUrl, previewUrl, 'ses_x')`).
- Integration: SSR-ready view — `StatusPoller` initial signature is built with `initialAgentSessionId='ses_x'`, first poll response is the same payload, poller does NOT navigate on the first tick (verifies the initial-signature seed includes `agentSessionId`).
- Render test: when the view is `Pending` with `pendingPhase: 'awaiting-agent-session'`, the sr-only announcement matches the new copy and the active-step indicator highlights step 4.

**Verification:**
- `pnpm --filter @openvoid/landing test` green.
- Typecheck clean.

---

### U5. Landing: deep-link URL helper + Ready surfaces consume it

**Goal:** Build the deep-link URL in one place and wire it through every `<a href>` and `CopyButton` surface in the Ready view.

**Requirements:** R1, R3, R6

**Dependencies:** U4

**Files:**
- Create: `services/landing/app/utils/agent-url.ts` (URL composer + `AGENT_PROJECT_PATH_B64` constant)
- Test: `services/landing/test/utils/agent-url.test.ts`
- Modify: `services/landing/app/actions/sessions/components/ready.tsx` (`ReadyProps` at 48-52, `DuoProps` at 132-135, the `<a href>` + `CopyButton` surfaces at 198-211 + 257-269 + 77)
- Modify: `services/landing/app/actions/sessions/page.tsx` (line 79 + 179 — pass `agentSessionId` into `ReadyProps`)

**Approach:**
- `agent-url.ts` exports:
  - `AGENT_PROJECT_PATH_B64 = 'L3dvcmtzcGFjZS9yZXBv'` (base64 of `/workspace/repo`). Comment cross-references `infra/images/opencode/Dockerfile`'s `WORKDIR /workspace/repo`.
  - `agentDeepLinkUrl(agentUrl: string, agentSessionId: string): string` — composes `${agentUrl.replace(/\/$/, '')}/${AGENT_PROJECT_PATH_B64}/session/${agentSessionId}`.
- `ready.tsx` `ReadyProps` adds `agentSessionId: string`. The `DuoProps` interface (lines 132-135) also adds `agentDeepLinkUrl: string` (composed once by `Ready` and passed down) so `ChatCard`'s internal surfaces stay consistent. `Duo` receives the composed value from `Ready` and forwards it.
- All three surfaces that currently bind to raw `agentUrl` switch to the composed deep-link:
  - `<a href={agentUrl}>` at line 204 → `<a href={agentDeepLinkUrl}>`
  - `OpenLinkShortcuts` at line 77 — `chatHref={agentUrl}` → `chatHref={agentDeepLinkUrl}`
  - `<CopyButton value={agentUrl} />` at line 199 → `<CopyButton value={agentDeepLinkUrl} />` (the URL users want to share/bookmark)
- `page.tsx` threads the new prop from `view` into `ReadyProps`.

**Patterns to follow:**
- Existing test shape in `services/landing/test/utils/ingress.test.ts:16-26` for tiny utility tests.
- Constants in `services/landing/app/utils/` co-located with the helper that uses them.

**Test scenarios:**
- Happy path: `agentDeepLinkUrl('http://abc.agent.example/', 'ses_xyz')` → `'http://abc.agent.example/L3dvcmtzcGFjZS9yZXBv/session/ses_xyz'`.
- Edge case: `agentUrl` without trailing slash → same output (no double `//`).
- Edge case: `agentUrl` with trailing slash → exactly one slash before the encoded path segment.
- Integration: `AGENT_PROJECT_PATH_B64` decodes to `/workspace/repo` (regression guard against a future typo). Use `Buffer.from(AGENT_PROJECT_PATH_B64, 'base64').toString('utf8') === '/workspace/repo'`.
- Integration: `ready.tsx` renders, `href` on the "Open chat"/"Open agent" surfaces contains both the `AGENT_PROJECT_PATH_B64` segment and the `agentSessionId` (existing render tests adapted).
- Integration: `CopyButton` `value` prop equals the full deep-link string (not just `agentUrl`).

**Verification:**
- `pnpm --filter @openvoid/landing test` green.
- Typecheck clean.
- Manual on Tilt cluster: new-app session → click "Open agent" → lands inside the Main conversation directly with no picker visible (deferred to PR test plan, not this unit's "done").

---

## System-Wide Impact

- **Interaction graph:** Session API gains an outbound HTTP dependency on its own pods. Cross-namespace (`openvoid-system` → `openvoid-sessions`). No new NetworkPolicy required at v1 (no NetworkPolicy enforcement today; Phase 8 will introduce one — note that the egress allowlist will need a rule scoped to `session-api` → `openvoid-sessions:8080` only, not a broader allow).
- **Error propagation:** The new helper swallows network/transient errors and returns `undefined` — the route handler's existing pattern (graceful degradation to `Pending`) absorbs that. No new error path bubbles up to the client. 401 is logged with a distinct operator-facing message (F4) but follows the same return-undefined contract.
- **State lifecycle risks:** Cache entries persist for the Session API process's lifetime, keyed by `(sid, podUid)`. Single-replica today (`infra/local/session-api.yaml` pins `replicas:1`); on restart, cache cold-starts and the next poll re-fetches. Pod-recreate-with-sid-preserved (operator manual delete-and-recreate, or any future controller-based pod-management pattern) invalidates the cache entry on UID mismatch (KD2) — the next call refetches the new pod's `agentSessionId`. Pod deletion does not need an explicit cache hook in v1; `findMainSessionId` is gated on `pod.metadata.annotations[NEW_APP_ANNOTATION]`, so an entry for a deleted-and-gone pod would simply never be queried again.
- **API surface parity:** None — `agentSessionId` is purely additive on the existing `GET /sessions/:id` response, and `awaiting-agent-session` is a new enum value (consumers handle unknown phases via the existing default-narration fallback). The TypeSpec source generates one shape consumed by both services; lockstep via the regenerate step in U1.
- **Integration coverage:** The race between "Service DNS resolvable" and "endpoints populated" is real but absorbed by R5 + the existing poll loop. The "pod Running but seed crashed before creating the Main session" case is covered by the existing `[seed] giving up: ...` semantics from PR #35 — landing stays in Pending with the `awaiting-agent-session` phase; operator sees the seed-failure logs.
- **Unchanged invariants:** Existing `Running` semantics for import-repo sessions (those never run seed-agent) — the new gate is annotation-scoped (KD9), so import-repo pods (no annotation) skip `findMainSessionId` entirely and continue to enter `Running` as today, without `agentSessionId` in the response.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Service DNS race produces sustained `Pending` flapping after pod is actually Ready | R5 + KD2 cache: single-failed-probe never downgrades; cache is sticky-once-found per `(sid, podUid)`. U2 tests cover the transient path. |
| OpenCode SPA-fallback 200 mistaken for a valid `/session` response | KD5: response-shape validation (Content-Type + array) before iterating. U2 test covers the SPA-fallback case. |
| Operator drift via `OPENVOID_SEED_SESSION_TITLE` override breaks deep-link silently | KD3: drop from passthrough AND hardcode in `seed-agent.sh`. Content-guard test in U3 locks the constant in place. |
| Import-repo pods accidentally gated on a non-existent Main session | KD9 + U3 annotation check + regression test on `findMainSessionId NOT called` for annotation-absent pods. |
| Auth header leaks into logs on error | KD4 + U2 approach: `authHeaderValue` stays scoped to the fetch invocation; error log shape is `{sid, error: err.message}`; abort/timeout test path explicitly asserts no header value in any observable. |
| `opencode-server-password` rotation causes silent indefinite `Pending` (stale cached auth) | U2 distinguishes 401 with a distinct operator-facing warning log (F4); runbook update (see Documentation / Operational Notes) instructs operator to restart Session API after rotation. v1.5 could add a graceful reload. |
| Pod-recreate-with-sid-preserved produces stale `agentSessionId` pointing at vanished OpenCode session | KD2 cache invalidates on `podUid` mismatch; deep-link refetches against the new pod automatically. U2 test covers the UID-mismatch path. |
| Title-collision in pre-seed window (user manually navigates to raw agent URL and creates own "Main" session before seed) | KD10 earliest-by-`time.created` match: seed-agent runs at pod boot, well before any user can interact — its session is provably first. U2 test asserts the smallest `time.created` wins regardless of array order. |
| `agentSessionId` in the deep-link URL acts as a bearer token to the agent SPA | Accepted threat model for v1 — the deep-link URL is treated as a shareable secret (the existing per-session pod hash in the host is already similar). `CopyButton`'s output is the secret URL; users should not share publicly. Phase 8 NetworkPolicy + agent-side auth on the public ingress are the architectural mitigations. |
| Cross-namespace network call breaks when NetworkPolicy lands (Phase 8) | Documented in System-Wide Impact: Phase 8's egress allowlist will need a rule scoped to `session-api` → `openvoid-sessions:8080`. Not blocking for v1. |
| `findMainSessionId` cache grows unbounded over Session API process lifetime | Acceptable for v1 — single-replica process, low session count. v1.5 can add a `delete(sessionId)` hook tied to pod deletion. |

---

## Documentation / Operational Notes

- `infra/images/opencode/README.md` "Seed-on-boot" env-knobs table — strike the `OPENVOID_SEED_SESSION_TITLE` row (no longer forward-able AND no longer overridable on the pod itself; the title is now a hard-coded build-time contract).
- `infra/images/opencode/seed-agent.sh` header comment / env table — same update; reflect that `SESSION_TITLE` is no longer an env-driven knob.
- `docs/runbooks/platform-github-org-setup.md` — re-check the diagnostic rows for any reference to the title env. Add a row to "seed-on-boot not firing" or a sibling section covering `opencode-server-password` rotation: rotating the Secret requires a `kubectl rollout restart deployment/session-api` to clear the cached `authHeaderValue`; without restart, all sessions will land in `awaiting-agent-session` until restart (F4 mitigation).
- After merge: capture a `docs/solutions/best-practices/` entry on (a) OpenCode SPA-fallback-200 handling in HTTP clients, (b) deep-link URL composition form for OpenCode's web UI, (c) the bearer-token-in-URL trade-off for SPA deep-links and how the team accepted it. None have prior coverage in the repo.

---

## Sources & References

- Related PR: #35 (auto-seed agent prompt — established the "Main" session, the seed-agent script, and the `SEED_PASSTHROUGH_ENV_NAMES` list this plan modifies).
- Related plan: `docs/plans/2026-05-22-001-feat-auto-seed-agent-prompt-plan.md`.
- Related diagram: `docs/diagrams/auto-seed-agent-prompt-flow.md` — the seed-side flow this plan composes on top of.
- Related learnings: `docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md`, `docs/solutions/best-practices/per-session-pod-pnpm-dev-boot-traps-2026-05-22.md`, `docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md`.
- Related spike: `docs/spikes/2026-05-02-opencode-endpoints.md` — endpoint surface, the SPA-fallback-200 quirk (KD5), and the `time.created` field used for collision-resistant matching (KD10).
- External: OpenCode's web UI URL form was established from a user-provided live URL during planning conversation.
