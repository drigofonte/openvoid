---
title: "feat: Auto-seed agent with user's prompt at session start"
type: feat
status: active
date: 2026-05-22
---

# feat: Auto-seed agent with user's prompt at session start

## Summary

When a new-app session boots, fire the user's landing-form prompt to OpenCode as the agent's first user message — from a short shell script invoked as a backgrounded sibling of `pnpm dev` and `opencode serve` inside the agent container's bash entrypoint. The seed is gated on `OPENVOID_NEW_APP=true`, a non-empty prompt in `app/scaffold-meta.json`, and an idempotency sentinel. By the time the user clicks "Open agent" the conversation already shows the prompt and the agent's accumulated `build`-mode response. Auth uses HTTP Basic on `127.0.0.1:8080` (loopback, not the public URL) and never echoes the password to stdout, mirroring the discipline from the just-merged pod-boot-traps learning.

---

## Problem Frame

The scaffold-bootstrap PR (`f5a13f1`, 2026-05-22) wires the prompt into `app/scaffold-meta.json` so the empty-state route can render it — but OpenCode itself never sees that prompt as a conversation turn. A user clicks "Open agent" and finds an empty session, then has to retype their idea. The Provisioning storyboard's payoff lands flat: the platform sold "your sandbox is starting" and the agent shows up at zero state. This plan closes that loop so the agent has already begun work by the time the user opens the UI.

---

## Requirements

- R1. The user's landing-form prompt is sent to OpenCode as the first user message of a session created automatically at agent-container boot.
- R2. The seed fires only for new-app sessions (`OPENVOID_NEW_APP=true`); import-repo sessions retain today's single-process behaviour unchanged.
- R3. The seed is skipped when the prompt is empty — the user can still type into the agent UI manually.
- R4. The seed is idempotent: an entrypoint restart inside the same pod lifetime does not produce a second auto-seed session.
- R5. The seed call uses HTTP Basic auth against `127.0.0.1:8080` with `$OPENCODE_SERVER_PASSWORD`, and **never** echoes the password into container stdout.
- R6. A successful seed does NOT bring the pod down. The script is a fire-and-forget background job; `wait -n` in the entrypoint continues to watch `pnpm dev` and `opencode serve` only.
- R7. The agent's first turn uses the `build` agent (autonomous, edit-capable) and inherits the model already pinned in the image's baked `opencode.json` (`openrouter/anthropic/claude-sonnet-4.5`).
- R8. Failures (health timeout, create-session non-2xx, prompt_async non-2xx) are logged with `[seed]`-prefixed messages and the sentinel is written anyway so the pod isn't stuck in a retry loop.

---

## Scope Boundaries

- No streaming of agent output back into landing's Provisioning storyboard. The storyboard continues to gate on `pendingPhase` only.
- No resumption of agent state if the pod restarts mid-run. Each session boots fresh; the sentinel exists only to prevent double-seeding within one pod lifetime.
- No multi-turn injection or scripted follow-ups beyond the seed prompt.
- No persistence of conversation history across sessions (matches scaffold-bootstrap brainstorm exclusion).
- No changes to the `app/scaffold-meta.json` contract (already-shipped; would break the empty-state route).
- No changes to the `import-repo` path.
- No changes to how landing surfaces the prompt to the user pre-session (form copy, placeholder text, etc.).
- No replacement of the existing `opencode serve` / `pnpm dev` orchestration. The seed is additive.

### Deferred to Follow-Up Work

- Capture a `docs/solutions/` entry on "seed-on-boot via entrypoint" once landed — the "wait for app-level health, not pod-level Ready" rule is reusable.
- A future surface that streams the agent's in-progress reasoning into landing's storyboard so the user sees activity before they open the agent tab.
- A reconciliation path for when an authenticated user returns to an existing session — out of scope until the returning-user surface lands.

---

## Context & Research

### Relevant Code and Patterns

- `infra/images/opencode/entrypoint.sh` — dual-process bash entrypoint already in place. `run_new_app()` (lines 77-108) backgrounds `pnpm --dir /workspace/repo dev` and `opencode serve --hostname 0.0.0.0 --port 8080`, both with `[dev]` / `[agent]` log-prefixed via process substitution, then `wait -n`. The seed must be a *third* background process that the trap forwards SIGTERM to but `wait -n` does not name — so a successful seed exit doesn't tear down the pod.
- `infra/images/opencode/Dockerfile` — `FROM node:22-alpine`, `apk add --no-cache bash`, `corepack prepare pnpm@10.33.0`. Adding `jq` is a 1-line `apk add` extension (~250 KB).
- `infra/images/opencode/opencode.json` — baked agent config. `instructions` array currently lists only `dev-server-bind.md`. `scaffold-extend.md` ships in the image (`infra/images/opencode/instructions/scaffold-extend.md`) but **is not loaded** because it's missing from this array — a bug surfaced by repo research. In scope for this plan because the seed message lands on an agent that, without that instruction, may `rm -rf` the scaffold instead of extending it.
- `infra/images/workspace-init/init.sh:81-93` — `write_scaffold_meta()` writes `/workspace/repo/app/scaffold-meta.json` with `{prompt, createdAt, scaffoldVersion}`. The seed script reads from the same path.
- `services/session-api/src/k8s/client.ts` — `buildAgentEnv(isNewApp)` (lines 509-528) is the seam for any new env vars. Already sets `OPENVOID_NEW_APP=true` for new-app pods.
- `infra/images/opencode/README.md` — runtime-interface table documents `:8080` + HTTP Basic + `GET /global/health`. Needs a short addendum on the seed step and a curl recipe for operators.

### Institutional Learnings

- `docs/solutions/best-practices/per-session-pod-pnpm-dev-boot-traps-2026-05-22.md` — load-bearing. The seed step must respect Trap 4 (PAT-in-stdout discipline; auth value must never reach stdout) and Trap 5 (Vite probe gates pod Ready on port 3000, not on OpenCode health on 8080 — so the seed cannot use `Ready=true` as its trigger).
- `docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md` — pod-loopback / nip.io trap. Any URL containing `127.0.0.1`, `localhost`, or `::1` is host-context-dependent. The seed runs *inside* the pod, so loopback DOES point at the right OpenCode instance — but the script must use literal `127.0.0.1`, not the public agent URL.
- `docs/solutions/documentation-gaps/github-pat-createinorg-administration-permissions-2026-05-22.md` — adjacent. Opaque 403s on credential-bearing calls cost hours. The seed's failure mode should leave a greppable trail in the logs + a documented curl recipe for the runbook.

### External References

- OpenCode v1.14.x HTTP API (https://opencode.ai/docs/server/). `POST /session` creates a session and returns `{id}`; `POST /session/:id/prompt_async` fires a message and returns `204 No Content` without waiting for the agent turn to complete. Default `agent: "build"` runs the autonomous edit-capable loop. Model field is optional and inherits from baked `opencode.json` when omitted.

---

## Key Technical Decisions

- **Seed lives in a dedicated shell script (`seed-agent.sh`), not inline in `entrypoint.sh`.** Keeps the entrypoint focused on PID-1 / dual-process / signal duties. Makes the seed testable as a discrete shell artifact (the existing test pattern reads scripts as text and asserts content guards).
- **Add `jq` to the `opencode` image as a hard dependency.** The seed script extracts `prompt` from `scaffold-meta.json` and `id` from the `POST /session` response — both are non-trivial JSON parses where shell hacks would be fragile. `jq` is ~250 KB. The alternative (a node-based helper) introduces a discipline mismatch with the rest of `infra/images/`.
- **Loopback `127.0.0.1:8080`, never the public agent URL.** Avoids the pod-loopback / nip.io trap captured in the May-9 learning doc and saves a Service round trip.
- **Gate on OpenCode's own `/global/health`, not on K8s `Ready`.** The pod's `readinessProbe` targets port 3000 (Vite), not 8080. A pod can be `1/2 Running` because Vite is misconfigured while OpenCode is happy — the seed must poll OpenCode's own health, with a bounded timeout.
- **Fire-and-forget via `POST /session/:id/prompt_async`, not the blocking `POST /session/:id/message`.** The blocking variant would hold the script open until the entire agent turn completes (could be minutes). `prompt_async` returns 204 immediately and the agent runs in the background — exactly what the seed wants.
- **Sentinel file at `/workspace/.openvoid-seeded`.** Sits on the per-session `emptyDir` volume — survives entrypoint restarts within a pod lifetime, evaporates with the pod (correct grain). Plain `touch` write; presence-check via `[ -f … ]`. Sentinel is written even on failure paths so a failed seed doesn't retry on every entrypoint restart.
- **Backgrounded job inside `run_new_app`, not named in `wait -n`.** `bash` recipe: `seed-agent.sh > >(sed 's/^/[seed] /') 2>&1 &` (no `disown` — the trap should still SIGTERM the seed on pod shutdown). The seed PID is captured for the trap but NOT passed to `wait -n`. A successful seed exits silently; a failed one logs and exits silently — neither tears down the pod.
- **Prompt framing wraps the raw user prompt with minimal "extend, don't rebuild" reinforcement.** Even with `scaffold-extend.md` correctly loaded (U2), the seed message itself re-states the constraint inline so the agent's first turn can't miss it.
- **Env-driven configuration from `services/session-api/src/k8s/client.ts`.** Every knob (prompt path, sentinel path, OpenCode URL, health timeout, session title) is an env var the script reads — no hardcoded paths in shell. Same image works across kind / DOKS / any future fabric without rebuild.
- **Wire `scaffold-extend.md` into `opencode.json` as part of this plan.** Discovered during research that the instruction file ships but isn't loaded. Fixing it here keeps the seed's effective behaviour aligned with the user's intent ("agent extends the scaffold"). 1-line opencode.json change; small enough to bundle without scope creep.

---

## Open Questions

### Resolved During Planning

- **Which OpenCode endpoint?** `POST /session/:id/prompt_async` — fire-and-forget, returns 204 immediately, agent runs to completion in the background.
- **Which agent mode?** `build` (autonomous edit-capable). `plan` is read-only.
- **Which model?** Inherit from baked `opencode.json` (`openrouter/anthropic/claude-sonnet-4.5`) — omit the `model` field on the request body. Lets operators retune via opencode.json without touching the seed script.
- **JSON parsing tool?** `jq`. ~250 KB and makes the script readable; the alternative (node-based helper) introduces a discipline mismatch with the rest of `infra/images/`.
- **Sentinel location?** `/workspace/.openvoid-seeded` (emptyDir volume, pod-lifetime scope).
- **Health-timeout default?** 120 s. Covers cold-boot of OpenCode + first-time DB migration; env-overridable via `OPENVOID_SEED_HEALTH_TIMEOUT_S`.
- **Session title?** `"openvoid auto-seed"`. Used only for human-readable session lists; no functional load.

### Deferred to Implementation

- The exact wording of the prompt framing ("the user described what they want to build: ... please start implementing, extend the existing scaffold rather than rebuilding from scratch"). Settled during U1 by iterating against a real session.
- Whether to add a small jitter to the health-poll loop. Probably unnecessary at v1's single-replica scale but worth noting if startup contention shows up.
- Whether the verification recipe lives in `docs/runbooks/` or `infra/images/opencode/README.md`. Both are reasonable; pick the one operators reach for first.

---

## High-Level Technical Design

> *This illustrates the intended boot sequence and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    autonumber
    participant K as Kubelet
    participant E as entrypoint.sh (PID 1)
    participant S as seed-agent.sh (bg)
    participant D as pnpm dev (bg, :3000)
    participant O as opencode serve (bg, :8080)
    participant FS as /workspace volume

    K->>E: Start agent container
    E->>E: Trap SIGTERM/INT
    E->>D: Background pnpm --dir /workspace/repo dev
    E->>O: Background opencode serve --port 8080
    E->>S: Background seed-agent.sh (only when OPENVOID_NEW_APP=true)
    E->>E: wait -n DEV_PID OPENCODE_PID
    Note over E,S: seed PID is NOT in wait -n's args — its exit does not collapse the pod

    S->>FS: Check /workspace/.openvoid-seeded
    Note over S: sentinel present → exit 0 silently
    S->>FS: Read /workspace/repo/app/scaffold-meta.json
    Note over S: empty prompt → write sentinel + exit 0

    loop until 200 OK or timeout
        S->>O: GET /global/health (Basic auth, loopback)
    end

    S->>O: POST /session (Basic auth, body title=openvoid auto-seed)
    O-->>S: { id: "ses_..." }
    S->>O: POST /session/{id}/prompt_async with framed prompt
    O-->>S: 204 No Content
    S->>FS: touch /workspace/.openvoid-seeded
    Note over O: Agent now running autonomously in build mode

    K->>O: readinessProbe httpGet :3000/ (gates on Vite, not on seed)
    O-->>K: 200 OK → Pod becomes Ready
    Note over E: User can now open agent UI; conversation has seed + in-progress response
```

---

## Implementation Units

### U1. Add `seed-agent.sh` script + `jq` to the opencode image

**Goal:** Ship a single-purpose shell script that handles the full seed orchestration (idempotency check, prompt read, health poll, session create, prompt_async, sentinel write) with strict auth-leak discipline.

**Requirements:** R1, R3, R4, R5, R7, R8.

**Dependencies:** None.

**Files:**
- Create: `infra/images/opencode/seed-agent.sh` — `#!/bin/bash`, `set -euo pipefail`. Reads env vars for every knob. Uses `curl -u opencode:"$OPENCODE_SERVER_PASSWORD" ...` (never URL-embedded). Uses `jq` for JSON read and write. Writes the sentinel even on every failure path so the script is naturally idempotent across entrypoint restarts.
- Modify: `infra/images/opencode/Dockerfile` — `apk add` line adds `jq`. `COPY seed-agent.sh /usr/local/bin/seed-agent` + `RUN chmod +x`. The script is invoked by name from `run_new_app` in U3.

**Approach:**
- Env contract the script consumes:
  - `OPENCODE_SERVER_PASSWORD` (already present) — HTTP Basic password.
  - `OPENVOID_SEED_PROMPT_PATH` (default `/workspace/repo/app/scaffold-meta.json`).
  - `OPENVOID_SEED_SENTINEL_PATH` (default `/workspace/.openvoid-seeded`).
  - `OPENVOID_SEED_OPENCODE_URL` (default `http://127.0.0.1:8080`).
  - `OPENVOID_SEED_HEALTH_TIMEOUT_S` (default `120`).
  - `OPENVOID_SEED_SESSION_TITLE` (default `openvoid auto-seed`).
- Script flow mirrors the Mermaid sequence above. Every log line is prefixed with `[seed]` so it's distinguishable from `[dev]` / `[agent]` in `kubectl logs`.
- Guard `jq -r .prompt` with a `[ -f "$prompt_path" ]` precheck. Under `set -euo pipefail` a missing meta file would otherwise crash the script before any failure-path code runs. A future scaffold-version bump that renames or removes the metadata file falls into the empty-prompt branch (sentinel written, script exits 0) rather than blowing up the pod's log stream.
- Prompt framing — wrap the raw prompt with one sentence of context + the extend-don't-rebuild reinforcement. Exact wording settled inline during implementation.
- Failure paths (health timeout, create-session non-2xx, prompt_async non-2xx) log a structured `[seed] giving up: <reason>` line, write the sentinel, exit 0. Never exit non-zero — that would surface as a pod-level error event for what is, semantically, a best-effort enrichment.

**Patterns to follow:**
- Token-leak discipline from `infra/images/workspace-init/init.sh` (the `git push` line, no `-u`). Auth value lives in the env var only; never in URL, never echoed.
- `[prefix] message` log style from the existing entrypoint's process-substitution sed prefixes.
- POSIX-leaning bash (entrypoint is already `#!/bin/bash`; we have `wait -n` + process substitution + `set -u`).

**Test scenarios:**

The script has no native test harness today (mirrors the existing pattern from the scaffold-bootstrap PR's workspace-init `init.sh` content guards in `services/session-api/test/routes.sessions.test.ts`). Test coverage is shell-content guards in the same file that read the script as text and assert on its content. Categories:

- Happy path — script contains the `until curl … /global/health` health poll with bounded timeout pulled from `OPENVOID_SEED_HEALTH_TIMEOUT_S`.
- Happy path — script POSTs to `/session` then to `/session/{id}/prompt_async` (string match on both paths).
- Happy path — sentinel is written via `touch` on the path read from `OPENVOID_SEED_SENTINEL_PATH`.
- Edge case — empty prompt branch: when `jq -r .prompt` on the meta file returns empty, script writes the sentinel and exits without calling OpenCode.
- Edge case — missing-file branch: when `[ -f "$prompt_path" ]` returns false, script writes the sentinel and exits 0 without crashing on the jq read.
- Edge case — sentinel-present early exit: `[ -f "$sentinel" ]` check at the top, exits 0 before any HTTP.
- Edge case — failure paths write the sentinel anyway (grep for sentinel-write after every error log).
- Security guard — script uses `curl -u opencode:"$OPENCODE_SERVER_PASSWORD"` form, NOT `curl https://opencode:...@host`. Negative assertion: no live (non-comment) line contains `https://*:*@` or `:${OPENCODE_SERVER_PASSWORD}@`. Strip comments before assertion (same technique used in the scaffold-bootstrap PR's workspace-init content guards).
- Security guard — script loopback target is `127.0.0.1`, not any nip.io / public host.
- Edge case — every knob is read from env, never hardcoded: grep for the default values appearing only inside `${VAR:-default}` patterns.

**Verification:** all shell-content guards pass; `bash -n seed-agent.sh` is clean; `docker build infra/images/opencode/` succeeds; the binary `/usr/local/bin/seed-agent` exists in the image and is executable.

---

### U2. Wire `scaffold-extend.md` into `opencode.json` instructions array

**Goal:** Fix the latent bug discovered during research — the `scaffold-extend.md` instruction ships in the image but isn't loaded because the `instructions` array in `opencode.json` doesn't list it. Without this, the agent receives the seed message (U1) without the contextual constraint to extend rather than rebuild.

**Requirements:** R7 (effective behaviour of the autonomous first turn).

**Dependencies:** None (parallel to U1).

**Files:**
- Modify: `infra/images/opencode/opencode.json` — extend `instructions` array to include the absolute path `/var/opencode-config/opencode/instructions/scaffold-extend.md` alongside the existing `dev-server-bind.md`.

**Approach:**
- 1-line array append.
- No content change to `scaffold-extend.md` itself.
- Verify by reading `opencode.json` in the running image — the `node -e 'JSON.parse(…)'` validation step in the Dockerfile already catches syntax errors at build time.

**Patterns to follow:**
- The existing `dev-server-bind.md` reference is the model.

**Test scenarios:**
- Manifest assertion: `opencode.json` parses as valid JSON (existing build-time validation covers this).
- Content guard: add a vitest case in `services/session-api/test/routes.sessions.test.ts` that reads `infra/images/opencode/opencode.json` as text and asserts the `instructions` array literally contains the exact path string `/var/opencode-config/opencode/instructions/scaffold-extend.md`. JSON-syntax validation alone wouldn't catch a typo in the path — and the bug this unit fixes is exactly "the instruction file isn't loaded", which a path typo would silently re-introduce.

**Verification:** `docker build` succeeds; running the image with the agent serves the new instruction (operators can verify by inspecting the OpenCode session — instructions appear in the system context).

---

### U3. Wire `seed-agent` as a backgrounded job in `entrypoint.sh` `run_new_app`

**Goal:** Invoke the seed script as a non-blocking sibling of `pnpm dev` and `opencode serve` inside `run_new_app`. The seed PID is captured for the SIGTERM trap but NOT named in `wait -n`, so a successful seed exit doesn't tear down the pod.

**Requirements:** R2, R6.

**Dependencies:** U1 (script must exist before entrypoint invokes it).

**Files:**
- Modify: `infra/images/opencode/entrypoint.sh` — extend `run_new_app()` to background `seed-agent` with the same process-substitution log-prefix pattern, capture its PID into `SEED_PID`, extend the trap to also `kill -TERM "$SEED_PID"` on TERM/INT, but **do not** add `SEED_PID` to the `wait -n` argument list.

**Approach:**
- Insertion point: after `OPENCODE_PID=$!` and BEFORE the existing `trap '...' TERM INT` declaration. Order matters: assign all three PIDs first, then declare the trap once referencing the full kill list. A trap declared before `SEED_PID` exists would silently `kill ""` (benign under `2>/dev/null || true`, but defeats the seed-cleanup intent if SIGTERM arrives during that microsecond gap).
  - `seed-agent > >(sed 's/^/[seed] /') 2>&1 &`
  - `SEED_PID=$!`
- Trap update: redeclare the trap line to include `"$SEED_PID"` in the kill list so the seed doesn't outlive the pod's SIGTERM window.
- `wait -n "$DEV_PID" "$OPENCODE_PID"` stays unchanged (the seed PID is deliberately NOT named here — see Approach in U1).

**Patterns to follow:**
- The existing `pnpm dev` / `opencode serve` background-and-log-prefix shape (entrypoint.sh:80-85).
- The trap shape (entrypoint.sh:90).

**Test scenarios:**
- Content guard: `entrypoint.sh` invokes `seed-agent` via process substitution (`> >(sed`), captures `SEED_PID`, lists `$SEED_PID` in the trap's kill list, and does NOT include `$SEED_PID` in any `wait -n` invocation.
- Negative assertion (regression guard): `wait -n` is still called with exactly `"$DEV_PID" "$OPENCODE_PID"` and nothing else.
- Content guard: invocation is only inside `run_new_app()` — `run_import_repo()` is unchanged.

**Verification:** `bash -n entrypoint.sh` clean. Manual smoke against kind shows three `[dev]` / `[agent]` / `[seed]` log streams in `kubectl logs` once the pod boots.

---

### U4. Plumb seed env vars from `services/session-api/src/k8s/client.ts`

**Goal:** Expose every seed knob as an env var on the agent container so operators can tune behaviour without rebuilding the image.

**Requirements:** R2 (env gating), implicit support for R4/R7/R8 (configurability of sentinel path, session title, health timeout).

**Dependencies:** U1 (script env contract defined), U3 (entrypoint reads from agent container env which session-api populates).

**Files:**
- Modify: `services/session-api/src/k8s/client.ts` — extend `buildAgentEnv(isNewApp)` to add the seed-tuning env vars when `isNewApp`. Defaults stay in the script (U1), so we only need to override if/when a knob is set on the Session API process via `OPENVOID_SEED_*` env passthrough.
- Modify: `services/session-api/test/routes.sessions.test.ts` — manifest assertions covering the new env vars in both modes.

**Approach:**
- Add constants for the env var names (mirrors the existing pattern for `OPENVOID_NEW_APP`).
- `buildAgentEnv(true)` returns the existing env plus a passthrough block: for each `OPENVOID_SEED_*` env present on the Session API process, set it on the agent container. Default behaviour (Session API env unset) leaves it to the script's own defaults — no env added on the manifest, no operator surprises.
- `buildAgentEnv(false)` is unchanged.

**Patterns to follow:**
- The existing `buildAgentEnv` shape (client.ts:509-528).
- The constants-at-top-of-file convention.

**Test scenarios:**
- Happy path: when `isNewApp=true` and no `OPENVOID_SEED_*` env on the Session API, the manifest's agent container env contains `OPENVOID_NEW_APP=true` and nothing seed-related (script defaults handle it).
- Happy path: when `isNewApp=true` and `OPENVOID_SEED_HEALTH_TIMEOUT_S=300` is set on the Session API process (use `vi.stubEnv`), the agent container env includes `OPENVOID_SEED_HEALTH_TIMEOUT_S` with value `300`.
- Edge case: when `isNewApp=false`, none of the seed env vars appear on the agent container env even if they're set on the Session API process. Import-repo pods don't seed.
- Regression: existing assertions on `OPENCODE_SERVER_PASSWORD` and `OPENVOID_NEW_APP` still pass.

**Verification:** `pnpm --filter @openvoid/session-api test` passes including the new cases; `tsc --noEmit` clean.

---

### U5. Operator docs + verification recipe

**Goal:** Surface the seed behaviour and a 3-command diagnostic recipe so the next operator hitting "agent didn't start" can bisect in five minutes.

**Requirements:** Indirect — supports R8 (failures leave a greppable trail) and the AGENTS.md compounding convention.

**Dependencies:** U1, U3 (behaviour to document must exist).

**Files:**
- Modify: `infra/images/opencode/README.md` — add a "Seed-on-boot" section under the existing runtime-interface table, including:
  - When the seed fires (`OPENVOID_NEW_APP=true` + non-empty prompt + sentinel absent).
  - Env knobs and defaults.
  - A 3-command diagnostic recipe: tail `[seed]` logs, check sentinel file inside the pod, hit `/session` from inside the pod to confirm OpenCode received the call.
- Modify: `docs/runbooks/platform-github-org-setup.md` — append a short "Seed not firing" subsection to the existing troubleshooting matrix.

**Approach:**
- README addition mirrors the existing prose density (no checklists where bullets suffice).
- Runbook update is one entry in the existing diagnostic table.

**Patterns to follow:**
- Existing README sections (Runtime interface table, Required environment, Mounted credentials).
- The diagnostic-table pattern in the platform-github-org-setup runbook.

**Test scenarios:**
- Test expectation: none — pure documentation. Verified by reader inspection.

**Verification:** Reading the README + runbook end-to-end, an operator who's never seen this feature can: (a) understand when and why the seed fires, (b) tell from logs alone whether the seed succeeded, (c) bisect a failure in three commands or fewer.

---

## System-Wide Impact

- **Interaction graph:** the agent container now has a third process (`seed-agent`) running briefly at boot. Trap fan-out goes from 2 PIDs to 3; `wait -n` argument list stays at 2 (intentional). No new ingress, Service, or RBAC.
- **Error propagation:** the seed script never exits non-zero — failures are always logged and the sentinel is written. A `[seed] giving up: <reason>` line in `kubectl logs` is the diagnostic surface; a pod-level error event is NOT the surface. Operators learn this from the README + runbook (U5).
- **State lifecycle risks:** sentinel file shares the workspace `emptyDir`. If the workspace volume is ever externalised (e.g., a PVC for cross-session persistence), the sentinel's semantics shift from per-pod to per-volume — would need revisiting at that time.
- **API surface parity:** none changed. session-api's `POST /sessions` shape is unchanged; only the per-session pod's env grows optional fields.
- **Integration coverage:** the cross-process timing (seed-after-health, seed-before-Ready) is testable only end-to-end. The shell-content guards in U1/U3 plus the manifest assertions in U4 do NOT prove the timing works — that's a kind-smoke verification, walked through in U5's runbook recipe.
- **Unchanged invariants:** `wait -n` argument list stays exactly `"$DEV_PID" "$OPENCODE_PID"` — load-bearing because adding the seed PID would tear the pod down on successful seed exit. `OPENCODE_SERVER_PASSWORD` continues to flow only via the env-vars-and-curl-`-u` discipline, never via URL embedding. Import-repo pods continue to run single-process.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Seed accidentally added to `wait -n` argument list (e.g., during a future refactor) → successful seed exit collapses the pod. | Regression-guard test in U3 asserts `wait -n` arguments are exactly `"$DEV_PID" "$OPENCODE_PID"`. |
| OpenCode v1.14.33's `/prompt_async` shape changes in a future OpenCode bump and the seed silently sends but the agent never runs. | Manual kind smoke verifies the agent's conversation history shows the seed + an assistant response. Operator runbook (U5) documents the diagnostic curl recipe so the next bump can re-verify in 3 commands. |
| `OPENCODE_SERVER_PASSWORD` leaks into stdout via a future seed-script change (someone adding `set -x` for debugging, or URL-embedding the auth). | Negative content guards in U1's test scenarios catch URL-embedded creds. The README + runbook reinforce the discipline. The 5-traps doc (already shipped) is the authoritative reminder. |
| Health-poll timeout default (120s) is too short for cold-boot scenarios with first-time OpenCode DB migration on a slow node. | Env-overridable via `OPENVOID_SEED_HEALTH_TIMEOUT_S`. Operator runbook documents how to bump per-environment. Failures don't crash the pod — agent UI still works manually. |
| `jq` parse of a malformed `scaffold-meta.json` (e.g., scaffold pushes a v2 file with a different shape). | Script uses `jq -r .prompt // empty` form; falls through to the empty-prompt branch (skip seed). The scaffold-version field is reserved for exactly this kind of shape evolution. |

---

## Documentation / Operational Notes

- After this lands, fold the "seed-on-boot via entrypoint" pattern into `docs/solutions/` via `/ce-compound`. The "wait for app-level health, not pod-level Ready" rule is reusable beyond this feature.
- README addition (U5) is the operator's authoritative surface for the env knobs.
- The 5-traps checklist (`docs/solutions/best-practices/per-session-pod-pnpm-dev-boot-traps-2026-05-22.md`) gets one more traversal pre-merge — this PR re-touches the entrypoint, adds a third process, and handles auth.

---

## Sources & References

- **Related code:**
  - `infra/images/opencode/entrypoint.sh` — dual-process entrypoint extended in U3.
  - `infra/images/opencode/Dockerfile` — `jq` added in U1.
  - `infra/images/opencode/opencode.json` — instructions array extended in U2.
  - `infra/images/workspace-init/init.sh:81-93` — scaffold-meta.json contract (source of truth for the prompt).
  - `services/session-api/src/k8s/client.ts:509-528` — `buildAgentEnv` extended in U4.
- **Related learnings:**
  - [`docs/solutions/best-practices/per-session-pod-pnpm-dev-boot-traps-2026-05-22.md`](docs/solutions/best-practices/per-session-pod-pnpm-dev-boot-traps-2026-05-22.md) — Trap 4 (PAT-in-stdout) and Trap 5 (Vite probe vs app-level health) are load-bearing constraints here.
  - [`docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md`](docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md) — pod-loopback / nip.io trap; informs the `127.0.0.1` decision.
- **External:**
  - OpenCode HTTP API docs — https://opencode.ai/docs/server/ (v1.14.x; matches the `opencode-ai@1.14.33` pin in `Dockerfile`).
- **Adjacent prior work:**
  - PR #34 (scaffold-bootstrap, merged `f5a13f1` on 2026-05-22) — established the scaffold-meta.json contract this plan reads from and the dual-process entrypoint this plan extends.
