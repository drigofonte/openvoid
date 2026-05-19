---
title: "feat: Coding-session scaffold bootstrap (new-app entry point)"
type: feat
status: active
date: 2026-05-12
origin: docs/brainstorms/2026-05-12-coding-session-scaffold-bootstrap-requirements.md
---

# feat: Coding-session scaffold bootstrap (new-app entry point)

## Summary

Wire a "new app" coding-session entry point end-to-end: protocol gains a `mode` + `pendingPhase` field, session-api creates a fresh per-app repo on a platform GitHub org via the REST API, the renamed `workspace-init` container seeds it from a Vite + React Router v7 scaffold template, the agent container runs `pnpm dev` alongside OpenCode under a managed dual-process entrypoint, and the Provisioning storyboard advances on real boot signals derived from init-container progress plus a port-3000 readiness probe.

---

## Problem Frame

The v1 lifecycle assumes the user provides a repo URL, but openvoid's target persona — a non-technical operator validating a product idea — cannot satisfy that prerequisite. After Provisioning Hi-Fi (PR #33), the storyboard sells "your sandbox is starting"; the user then clicks *Open preview* and lands on a 503. The asymmetry undermines the storyboard the moment users start using the product. See origin: `docs/brainstorms/2026-05-12-coding-session-scaffold-bootstrap-requirements.md` for the full pain framing and persona context.

---

## Requirements

Requirements R1–R10 are carried from the origin requirements doc verbatim. See origin: `docs/brainstorms/2026-05-12-coding-session-scaffold-bootstrap-requirements.md` for full bullet wording.

**Entry point and source control**
- R1. Landing exposes a "Start a new app" entry point that does not require a repo URL; existing import-repo path remains additively.
- R2. Platform owns a single source-control org (GitHub this iteration); no per-user Git credentials.
- R3. Each new app maps to a single repo on the platform org; unique name guaranteed without a collision-retry loop.

**Scaffold**
- R4. Canonical scaffold is Vite + React + React Router v7 framework mode, genuinely minimum.
- R5. Scaffold's index route renders a deliberate empty state and surfaces the session-creation prompt by reading a committed metadata file.
- R6. Scaffold ships a committed README asking the agent to extend rather than rebuild (soft constraint).

**Workspace bootstrap**
- R7. `workspace-init` (renamed from `git-clone`) clones the scaffold template, strips history, reinitialises against the new app repo, writes the prompt metadata, commits, pushes, runs `pnpm install` — all synchronously before agent container starts.
- R8. Session reports Running only when an HTTP probe to pod port 3000 returns 2xx; otherwise Provisioning.
- R9. Dev server runs alongside the OpenCode agent inside the agent container for v1.

**Storyboard alignment**
- R10. The Provisioning Hi-Fi storyboard's five steps wire to real boot signals (not a synthetic timer); final step gated on the same probe as R8.

**Origin actors:** A1 (Business operator), A2 (Landing page), A3 (Session API), A4 (workspace-init sidecar), A5 (OpenCode agent), A6 (Platform source-control org).
**Origin flows:** F1 (New app session — first time).
**Origin acceptance examples:** AE1 (covers R1, R7, R3), AE2 (covers R8, R10), AE3 (covers R5), AE4 (covers R3 — repo-name uniqueness under concurrent identical prompts).

---

## Scope Boundaries

- No Helm chart consolidation. This plan adds new raw manifests under `infra/local/` following the existing example-Secret pattern; full chart consolidation remains v1 plan Phase 9 work.
- No returning-user surface or app picker on the landing — origin scope boundary; repos persist on the platform org but are not reachable from the UI after session end.
- No Azure DevOps support — origin scope boundary. The github helper module is the natural seam if v1.5 picks it up; no abstraction layer added preemptively.
- No pre-baked scaffold container image with prebuilt `node_modules` — origin scope boundary.
- No dev-server sidecar split — origin scope boundary.
- No shadcn pre-install, app shell, theme provider, or layout primitives in the scaffold — origin scope boundary.
- No hard file locks on `vite.config.ts` / `app/root.tsx` / `package.json` — soft README constraint only.
- No pod-orphan cleanup (repo created but pod-create rolls back) — accepted in v1; documented in runbook only.
- The home page's other `data-coming-soon` alt buttons (`Import GitHub repo`, `Upload codebase`, `Fork an example`) are not activated by this plan.
- No publish-and-share surface for the prototyped app — separate feature.

### Deferred to Follow-Up Work

- Helm chart absorption of the new `infra/local/github-platform-creds-secret.yaml` manifest, RBAC patch, and Session API env wiring: tracked under v1 plan Phase 9 chart consolidation.
- Distilling RR7-framework-mode-in-K8s and Vite-allowedHosts learnings into `docs/solutions/` after the scaffold ships.

---

## Context & Research

### Relevant Code and Patterns

- `services/session-api/src/k8s/client.ts` — single integration point for K8s. All container/image names, ports, namespaces, labels, annotations, resource budgets live as exported constants at the top. `buildSessionPodManifest` + `K8sSessionOps.createSessionResources` are the seams this plan extends.
- `services/session-api/src/routes/sessions.ts` — Hono handler. Hand-validated with `isCreateRequest` type-guard. Uniform error envelope `{ code, message }` with stable codes (`invalid_body`, `invalid_request`, `not_found`, `k8s_unavailable`).
- `packages/protocol/main.tsp` — TypeSpec source. Regen via `pnpm --filter @openvoid/protocol generate`. Outputs `packages/protocol/generated/{openapi.yaml,types.ts}`.
- `services/landing/app/actions/home/{page.tsx,controller.tsx}` — current home form. Controller injects `repo = OPENVOID_DEFAULT_REPO` server-side (form has no repo input today).
- `services/landing/app/actions/sessions/client/provisioning-storyboard.tsx` — synthetic 25s timer with seeded per-session randomness. Inline DOM contract: `#step-0..#step-4`, `#eta`, `#bar-fill`, `#log-cursor`, `[data-storyboard]`.
- `services/landing/app/utils/derive.ts` — maps `Session` → discriminated `View`; today treats Running + both URLs populated as `ready`, else `provisioning` with `pendingPhase: 'running-pre-ingress'`. The discriminator is the natural extension point for new pending sub-phases.
- `services/landing/app/utils/api.ts` + `app/actions/api/sessions-status/controller.tsx` — poll-based status flow (1s/5s/10s) with `navigate({ history: 'replace' })` on signature flip.
- `infra/images/git-clone/{Dockerfile,clone.sh}` — current init container. Alpine/git base, plain bash script, clones into `/workspace/repo`, strips token from on-disk remote, sets up group-writable perms for the agent's fsGroup.
- `infra/images/opencode/{Dockerfile,entrypoint.sh,instructions/dev-server-bind.md}` — agent container. Entrypoint exec-handles SIGTERM for OpenCode; `dev-server-bind.md` already exists and will become authoritative for the bind shape.
- `infra/local/git-creds-secret.yaml{,.example}` and `infra/local/opencode-{password,auth}-secret.yaml{,.example}` — canonical pattern for out-of-band Secret provisioning: `.example` ships with documentation; populated file is gitignored.
- `infra/local/session-api.yaml` — raw Deployment + Service + ServiceAccount + Role + RoleBinding. RBAC currently grants `secrets get` scoped to `resourceNames: [opencode-server-password]` only.
- `Tiltfile` root — `session_pod_image(name, dir)` helper for building per-container images with cache-busting via `crictl rmi`.

### Institutional Learnings

- `docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md` — pod-loopback / nip.io trap. Any URL containing `127.0.0.1` / `localhost` / `::1` is host-context-dependent; in-cluster resolution hits the pod's own loopback, not the host. The `LANDING_SKIP_INGRESS_PROBE` env-gate pattern is the precedent for any new server-side probe of public URLs. This plan deliberately avoids that path — the port-3000 probe is a Kubernetes `readinessProbe` running inside the pod, not a session-api-side fetch of the public preview URL.
- `docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md` — cluster-fabric differences belong in Helm values, not session-api code. Native sidecars (init container with `restartPolicy: Always`) require K8s 1.33+; kind + DOKS both support this in v1, so accept the dependency without templating a fallback.
- `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md` — adjacent. One outer max-width, one Stack, no per-section width plumbing. Reference `services/landing/app/actions/sessions/components/ready.tsx` for the new-app entry-point form composition.
- `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` — Remix 3 SSR lowercases unknown camelCase attributes silently. New form code must use `value=` not `defaultValue=`, render `<textarea>` initial content as a child, etc.

### External References

External research was skipped. RR7 framework-mode scaffold and octokit (`@octokit/rest`) repo-create are well-known territory; the scaffold's structure follows the documented `react-router framework` template; the platform-org PAT scope is a documented GitHub setting (`Administration: write` + `Contents: write`).

---

## Key Technical Decisions

- **Port-3000 readiness as Kubernetes readinessProbe, not session-api-side fetch.** The probe runs inside the pod, against `localhost:3000`. session-api maps `pod.status.conditions[Ready] == True` to `status: "Running"`. This avoids the pod-loopback / nip.io trap captured in the May-9 learning doc and keeps session-api stateless. Trade-off: an unhealthy readinessProbe also pulls the pod out of Service endpoints, which is the correct shape for a broken dev server but means a transiently-restarting dev server flips status. Acceptable in v1.
- **`pendingPhase` enum on the protocol, not SSE.** The Session model gains an optional `pendingPhase` discriminator (`provisioning | seeding-scaffold | installing-deps | awaiting-dev-server | running-pre-ingress`). Landing's existing 1s/5s/10s poller continues to drive UI; the storyboard reads `pendingPhase` to advance steps. Reusing the poll path keeps Phase-7 architecture intact; SSE remains deferred to a future plan if real-time agent output ever demands it.
- **Two GitHub credential sources: `git-creds` (user-side, unchanged) + new `github-platform-creds` (platform-org PAT).** The platform PAT requires `Administration: write` + `Contents: write` on the org; user PATs are scoped per-repo and cannot create repos under the platform org. Keeping them separate respects the principle of least privilege and lets the import-repo path keep functioning unchanged.
- **Agent container runs `pnpm dev` + `opencode serve` as siblings under a bash-managed entrypoint.** Pattern: launch both as backgrounded children, `trap` SIGTERM forwarding to both PIDs, `wait -n` to exit when the first child dies. Alternative (agent runs `pnpm dev` as a tool call) was rejected because it defers preview-readiness to the agent's first action, defeating the brainstorm's "no 503" goal.
- **Idempotency at session-api via in-memory keyed cache on `Idempotency-Key`.** Form already submits the header (server-generated UUID); session-api today ignores it. A 5-minute LRU keyed by `Idempotency-Key` → `{ sessionId, status }` is sufficient for v1's single-replica deployment. Distributed shape (Redis-backed) deferred until horizontal scale becomes real.
- **Soft README constraint reinforced by an agent-side instruction file.** The scaffold's committed README asks OpenCode to extend rather than rebuild; in parallel, a new `infra/images/opencode/instructions/scaffold-extend.md` file teaches the same constraint to the agent through its system-prompt surface. Belt-and-suspenders given the deferred uncertainty in R6 about whether OpenCode reliably reads `README.md` as context.
- **Rename `git-clone` → `workspace-init` lands as the first unit, behavior-preserving.** The constant `GIT_CLONE_CONTAINER_NAME`, the `infra/images/git-clone/` directory, the Tiltfile invocation, and several regression-guard test assertions all reference the old name. Separating the rename from the new-app behavior addition keeps each commit reviewable.
- **Slug algorithm: lowercase kebab + alphanumeric, ≤40 chars, plus `-` + 6-char base32 random suffix.** Falls back to `app-<suffix>` when no prompt. Random suffix is the uniqueness strategy; no collision-retry loop. Base32 over hex for visual density.
- **Pod-orphan on partial failure is accepted in v1.** If session-api creates the repo on GitHub but Pod creation then fails and rolls back, the repo persists on the platform org with no associated session. Cleanup is runbook-only (operator deletes orphaned repos manually) until v1.5 introduces a reconciliation job.

---

## Open Questions

### Resolved During Planning

- *GitHub repo-create API call shape and credential handling:* Use `@octokit/rest` `repos.createInOrg`. Platform PAT lives in new Secret `github-platform-creds` in the `openvoid-sessions` namespace (alongside `git-creds`, so workspace-init can `secretKeyRef` it directly — Kubernetes doesn't support cross-namespace Secret refs). session-api reads it once at boot via the in-cluster K8s API (mirrors `loadOpencodeAuthHeader`); RBAC granted via Role extension on the existing `session-api-pods` Role.
- *HTTP probe shape and where it runs:* K8s `readinessProbe` on the agent container (`tcpSocket` or `httpGet` on port 3000 path `/`). Session-api maps `pod.conditions[Ready]==True` → `status: "Running"`.
- *Storyboard signal transport:* New `pendingPhase` discriminator on `Session` protocol; landing maps phase → active step in `derive.ts`. Poll-driven, no SSE.
- *Slug algorithm and metadata filename:* lowercase kebab, alphanumeric, ≤40 char + `-<6charBase32>` suffix; metadata at `app/scaffold-meta.json` with `{ prompt, createdAt, scaffoldVersion }`.
- *Where the "extend, don't rebuild" instruction lives:* Both the scaffold's committed `README.md` AND a new `infra/images/opencode/instructions/scaffold-extend.md` baked into the agent image.

### Deferred to Implementation

- Exact wording of the scaffold-extend instruction (depends on testing OpenCode's behavior on first-prompt against the scaffold).
- Exact wording and styling of the scaffold's index-route empty state. The plan specifies the contract (reads `app/scaffold-meta.json`, surfaces the prompt, invites the user to talk to the agent) but the visual treatment is settled during U3 by iterating the scaffold repo's `app/routes/_index.tsx`.
- Whether `pnpm install` runs as a workspace-init step or as `RUN pnpm install` baked into a scaffold layer of the agent image. v1 default: workspace-init step (matches origin R7); revisit if cold-boot time becomes painful.
- Final platform-org GitHub username (`openvoid-platform` is preferred; subject to availability check at runbook time).

---

## High-Level Technical Design

> *This illustrates the intended boot sequence and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    autonumber
    participant U as A1 Business operator
    participant L as A2 Landing (Remix 3)
    participant S as A3 Session API
    participant GH as A6 GitHub (platform org)
    participant WI as A4 workspace-init initContainer
    participant AG as A5 OpenCode + pnpm dev (main container)
    participant K8s as Kubernetes

    U->>L: Submits "Start a new app" with prompt
    L->>S: POST /sessions { mode: "new-app", prompt, idempotencyKey }
    S->>S: slugify(prompt) + 6-char base32 suffix
    S->>GH: octokit.repos.createInOrg({ org, name })
    GH-->>S: { html_url, ssh_url }
    S->>K8s: Create Pod (workspace-init + agent containers) + Service + Ingress
    S-->>L: 201 { sessionId, status: "Pending", pendingPhase: "provisioning" }
    L->>U: Render Provisioning storyboard (step 1 active)

    WI->>WI: Clone scaffold-react-rr7; strip .git; init + remote add
    WI->>WI: Write app/scaffold-meta.json with prompt
    WI->>GH: git push -u origin main
    L->>S: GET /sessions/:id (poll)
    S-->>L: status: "Pending", pendingPhase: "seeding-scaffold"
    L->>U: Storyboard step 2 active

    WI->>WI: pnpm install
    L->>S: GET /sessions/:id (poll)
    S-->>L: status: "Pending", pendingPhase: "installing-deps"
    L->>U: Storyboard step 3 active

    Note over AG: agent container starts;<br/>entrypoint launches pnpm dev + opencode serve

    L->>S: GET /sessions/:id (poll)
    S-->>L: status: "Pending", pendingPhase: "awaiting-dev-server"
    L->>U: Storyboard step 4 active

    K8s->>AG: readinessProbe GET localhost:3000
    AG-->>K8s: 200 OK (Vite serving)
    K8s->>K8s: Pod condition Ready = True

    L->>S: GET /sessions/:id (poll)
    S-->>L: status: "Running", agentUrl, previewUrl
    L->>U: Storyboard step 5 complete; "Open preview" CTA appears
    U->>AG: Browser navigates to previewUrl
    AG-->>U: index route renders empty state with prompt
```

---

## Implementation Units

```mermaid
graph TD
    U1[U1 Rename init container]
    U2[U2 Platform GitHub creds + Secret + RBAC]
    U3[U3 Scaffold template repo on platform org]
    U4[U4 Protocol: mode + pendingPhase]
    U5[U5 GitHub repo-create helper + slug algo]
    U6[U6 session-api new-app POST path + idempotency]
    U7[U7 workspace-init script: new-app branch]
    U8[U8 Agent container: pnpm dev + readinessProbe]
    U9[U9 Session status: gate Running + emit pendingPhase]
    U10[U10 Landing: new-app entry + storyboard rewire]

    U1 --> U7
    U1 --> U8
    U1 --> U9
    U2 --> U3
    U2 --> U5
    U3 --> U7
    U4 --> U5
    U4 --> U6
    U4 --> U9
    U4 --> U10
    U5 --> U6
    U6 --> U9
    U6 --> U10
    U7 --> U9
    U8 --> U9
    U9 --> U10
```

### U1. Rename `git-clone` init container to `workspace-init` (behavior-preserving)

**Goal:** Cosmetic-only rename touching every reference site so subsequent units add new behavior to a correctly-named surface.

**Requirements:** R7 (terminology).

**Dependencies:** None.

**Files:**
- Modify: `services/session-api/src/k8s/client.ts` — rename `GIT_CLONE_CONTAINER_NAME` constant to `WORKSPACE_INIT_CONTAINER_NAME`; update `buildSessionPodManifest` to use it; rename internal helper names accordingly.
- Modify: `services/session-api/test/routes.sessions.test.ts`, `services/session-api/test/k8s/session-ops.test.ts` — update all string assertions that reference `"git-clone"` to `"workspace-init"`; update import of the renamed constant.
- Rename directory: `infra/images/git-clone/` → `infra/images/workspace-init/`. Inside: `Dockerfile`, `clone.sh` (script name unchanged in this unit; script-rename is in U7).
- Modify: `Tiltfile` — `session_pod_image("git-clone", "infra/images/git-clone")` → `session_pod_image("workspace-init", "infra/images/workspace-init")`.
- Modify: `infra/images/git-finalizer/entrypoint.sh` — update comment references to "git-clone" pointing at the previous init container; behavior unchanged.

**Approach:**
- Single atomic commit: rename constant, dir, image name in Tiltfile, and all tests in one pass.
- Preserve the existing `clone.sh` script name in this unit; U7 introduces a new entrypoint script when adding new-app branching.
- The image tag `:dev` keeps working because cache-busting via `crictl rmi` already exists in the Tiltfile.

**Patterns to follow:**
- Constants-at-top-of-file convention in `services/session-api/src/k8s/client.ts` (lines 11–118).
- Image-name follows `localhost:5001/openvoid/<name>:dev` form.

**Test scenarios:**
- Happy path: `buildSessionPodManifest` returns a pod manifest with one initContainer named `workspace-init` and one with `git-finalizer`; no container named `git-clone` exists in the manifest.
- Regression guard: `git-creds` Secret remains mounted only on `workspace-init` + `git-finalizer`, NOT on the main agent container (existing test, updated for new name).
- Regression guard: `opencode-auth` Secret remains mounted only on the main agent container, NOT on `workspace-init` (existing test, updated for new name).
- Happy path: `Tiltfile` builds the renamed image; `tilt up` against kind shows the workspace-init container running the same clone behavior.

**Verification:**
- All existing tests pass with no behavior change. Manifest produced by `buildSessionPodManifest` differs from main only in container/image names.

---

### U2. Provision platform GitHub credentials and Secret manifest

**Goal:** Stand up the new `github-platform-creds` Secret with `.example` companion and runbook, and extend session-api's RBAC to read it. The org and PAT are provisioned out-of-band by the operator (one-time, documented).

**Requirements:** R2.

**Dependencies:** None (parallel to U1).

**Files:**
- Create: `infra/local/github-platform-creds-secret.yaml.example` — `Opaque` Secret in the **`openvoid-sessions` namespace** (not `openvoid-system`), `stringData.token: <PAT_PLACEHOLDER>`, header comment with PAT-creation runbook (org name, required scopes `Administration: write` + `Contents: write`, regen schedule). Same namespace as the pre-existing `git-creds-secret.yaml` so workspace-init (which runs in `openvoid-sessions`) can mount it directly via `secretKeyRef` — Kubernetes does not support cross-namespace Secret refs.
- Create: `infra/local/github-platform-creds-secret.yaml` — gitignored; populated by operator from `.example`.
- Modify: `.gitignore` — add `infra/local/github-platform-creds-secret.yaml` to existing Secret-ignore block.
- Modify: `infra/local/session-api.yaml` — extend the existing `session-api-pods` Role's `secrets get` rule (which already lives in `openvoid-sessions`) with `resourceNames: ["opencode-server-password", "github-platform-creds"]`. **Do not** add a `secretKeyRef` env on the Deployment — session-api lives in `openvoid-system`, the Secret lives in `openvoid-sessions`, and Kubernetes does not support cross-namespace `secretKeyRef`. Instead, add only a plain env var `OPENVOID_PLATFORM_GITHUB_ORG: "openvoid-platform"` on the Deployment; session-api reads `github-platform-creds.token` at boot via the K8s API (mirrors `loadOpencodeAuthHeader` in `services/session-api/src/k8s/client.ts`).
- Modify: `services/session-api/README.md` (if present, else create) — document the new env var (`OPENVOID_PLATFORM_GITHUB_ORG`), the boot-time Secret read for `github-platform-creds`, and link to the runbook.
- Create: `docs/runbooks/platform-github-org-setup.md` — step-by-step: create the org, create the PAT with the right scopes, populate the Secret manifest in `openvoid-sessions`, apply, restart session-api.

**Approach:**
- Pattern matches existing `git-creds-secret.yaml{,.example}` precisely: same Secret type, same `openvoid-sessions` namespace, same gitignore convention.
- RBAC change is additive — the existing `opencode-server-password` access is preserved; we only widen `resourceNames`.
- session-api reads the PAT via the in-cluster K8s API at boot, not via envFrom. This is the only viable shape because the Secret lives in `openvoid-sessions` (where workspace-init needs it) while session-api lives in `openvoid-system` — `secretKeyRef` cannot cross namespaces. The boot-time read pattern is already established by `loadOpencodeAuthHeader`. If the read fails (Secret missing or RBAC misconfigured), session-api exits with a clear log at boot, same as today's opencode-password path.

**Test scenarios:**
- Test expectation: none for this unit — pure infrastructure manifest and runbook. The Secret-consumption tests live in U5 (where the github helper reads the env var) and U6 (where the new-app route triggers a real repo create against a mock).

**Verification:**
- `kubectl apply -f infra/local/github-platform-creds-secret.yaml` succeeds against a clean kind cluster; `kubectl get secret -n openvoid-sessions github-platform-creds` returns the Secret.
- `kubectl get role -n openvoid-sessions session-api-pods -o yaml` includes both `opencode-server-password` and `github-platform-creds` in `resourceNames`.
- Operator follows the runbook end-to-end; session-api logs `loaded github-platform-creds` at boot and `OPENVOID_PLATFORM_GITHUB_ORG` is set on the Deployment env.

---

### U3. Create scaffold template repo on platform org

**Goal:** Establish `openvoid-platform/scaffold-react-rr7` (the canonical scaffold template) on the platform GitHub org. The repo lives outside this monorepo, but its structure is part of the v1 delivery and documented in `docs/scaffolds/`.

**Requirements:** R4, R5, R6.

**Dependencies:** U2 (org and creds exist).

**Files (in this repo, documenting the external scaffold):**
- Create: `docs/scaffolds/react-rr7-minimum.md` — narrative description of the scaffold's contents, the README's "extend, don't rebuild" guidance text verbatim, the contract for `app/scaffold-meta.json` (field names, types, semantics), and the index-route empty-state behavior.

**Files (on the external `openvoid-platform/scaffold-react-rr7` repo, committed by the operator on initial seed — NOT in this monorepo):**
- `package.json` — Vite + react + react-router (v7, framework mode) + typescript. No additional runtime deps. pnpm-workspace not required (single package).
- `pnpm-lock.yaml` — committed lockfile.
- `vite.config.ts` — single dev server config. Binds `0.0.0.0:3000`; `server.allowedHosts: true` per the v1 plan's flagged DNS-rebinding trade-off (acceptable in v1; tightening tracked at the v1-plan level).
- `app/root.tsx` — RR7 root with `<Outlet />`, basic HTML shell, no styling system.
- `app/routes/_index.tsx` — empty-state index route. Imports `~/scaffold-meta.json`; renders the user's prompt if present (`<h1>Building: {meta.prompt}</h1>`) or a generic "Your new app — talk to the agent to build it" otherwise. Single centered card, no nav, no shell.
- `app/scaffold-meta.json` — committed placeholder `{ "prompt": "", "createdAt": "", "scaffoldVersion": "v1" }`. workspace-init overwrites at seed time (U7).
- `tsconfig.json`, `react-router.config.ts` — RR7 framework-mode defaults.
- `README.md` — minimal: (a) explanation of the scaffold layout, (b) explicit "Agent guidance" section asking OpenCode to extend rather than rebuild (the same wording as `infra/images/opencode/instructions/scaffold-extend.md` from U7), (c) how to run locally.

**Approach:**
- Operator creates the repo, commits the initial scaffold from a local working copy, pushes. The scaffold repo is treated as an artifact of v1 — versioned, can be updated; updates do not retroactively touch existing app repos.
- The scaffold-meta.json placeholder is committed because workspace-init does a real edit-and-commit at seed time; pre-existing file simplifies the seed step.
- Scaffold layout is *minimum*: no shadcn primitives, no theme provider, no auth, no sidebar, no layout components. Per origin R4.

**Test scenarios:**
- Test expectation: none for this unit — scaffold is an external artifact whose correctness is verified by end-to-end probe in U9/U10. The contract (filename, JSON shape, scaffold-version field) is asserted in U7's tests when workspace-init writes to it.

**Verification:**
- Operator can `git clone https://github.com/openvoid-platform/scaffold-react-rr7.git && pnpm install && pnpm dev` and see Vite serve the empty-state route at `http://localhost:3000/`.
- The scaffold's README, file structure, and `app/scaffold-meta.json` shape match `docs/scaffolds/react-rr7-minimum.md` in this repo.

---

### U4. Protocol contract: add `mode` and `pendingPhase`

**Goal:** Extend the `CreateSessionRequest` and `Session` models in TypeSpec to support the new-app flow and surface pending sub-phases for the storyboard.

**Requirements:** R1, R10.

**Dependencies:** None (parallel to U1, U2).

**Files:**
- Modify: `packages/protocol/main.tsp` — add `SessionMode = "new-app" | "import-repo"` enum; change `CreateSessionRequest.repo` to optional and add `mode: SessionMode` (required); add `prompt?: string`; add `PendingPhase = "provisioning" | "seeding-scaffold" | "installing-deps" | "awaiting-dev-server" | "running-pre-ingress"` enum; add `pendingPhase?: PendingPhase` to `Session`; add a `SessionError { code: string, message: string }` model and `error?: SessionError` to `Session` (populated when `status == "Failed"`; used by landing's new `failed` view in U10).
- Modify: `packages/protocol/main.tsp` — server-side rule expressed in description: when `mode == "import-repo"`, `repo` is required; when `mode == "new-app"`, `repo` must be absent and `prompt` is optional. Document under each field.
- Run: `pnpm --filter @openvoid/protocol generate` — regenerates `packages/protocol/generated/{openapi.yaml,types.ts}`.
- Modify (downstream): `services/session-api/src/routes/sessions.ts` — update `isCreateRequest` type-guard to enforce the mode/repo conditional rule; this unit only updates the type-guard signature and rejection logic, not the new-app handler (that lives in U6).
- Modify (downstream): `services/landing/app/utils/api.ts` — types regenerate automatically through the import; no behavior change in this unit.

**Approach:**
- Single regen. Verify the regen is idempotent on no-op rerun (existing v1-plan test scenario).
- Conditional-required validation in `isCreateRequest` is hand-rolled (matching today's style; no library adoption).
- `pendingPhase` is *additive* — existing Running-with-URLs sessions just don't set it; landing's `derive.ts` keeps current behavior when absent.

**Patterns to follow:**
- TypeSpec change → regen → consumer-imports-update is the established workflow; see prior v1-plan unit references for protocol bumps.
- Hand-rolled type-guard validation style in `services/session-api/src/routes/sessions.ts`.

**Test scenarios:**
- Happy path: `pnpm --filter @openvoid/protocol generate` produces no diff on re-run after a single change run.
- Happy path: `isCreateRequest({ mode: "new-app", prompt: "AI flashcards" })` → true.
- Happy path: `isCreateRequest({ mode: "import-repo", repo: "https://github.com/foo/bar.git" })` → true.
- Edge case: `isCreateRequest({ mode: "new-app", repo: "https://..." })` → false (rejects: new-app must not have repo).
- Edge case: `isCreateRequest({ mode: "import-repo" })` → false (rejects: import-repo must have repo).
- Edge case: `isCreateRequest({ mode: "unknown" })` → false.
- Edge case: `isCreateRequest({})` → false (rejects: mode required).
- Happy path: `Session` accepts `pendingPhase: undefined` (existing sessions unchanged).
- Happy path: each `pendingPhase` enum value type-checks.

**Verification:**
- `pnpm --filter @openvoid/protocol generate` reports no diff on no-op rerun.
- All existing session-api tests pass after `isCreateRequest` updates (no semantic regression for import-repo path).
- Generated `types.ts` exports the new `SessionMode` and `PendingPhase` enums.

---

### U5. GitHub repo-create helper and slug algorithm

**Goal:** A small, testable module that takes a slug and creates a public repo on the platform org. Idempotent via uniqueness-guaranteeing slug suffix (collisions are vanishingly rare; on collision, surface as a transient error).

**Requirements:** R3.

**Dependencies:** U2 (creds), U4 (protocol shape).

**Files:**
- Create: `services/session-api/src/lib/github.ts` — exports `createAppRepo({ org, baseName }): Promise<{ repoName, htmlUrl, cloneUrl }>` and `slugify(prompt?: string): string` (returns `<kebab-slug-or-app><dash><6char-base32>`).
- Create: `services/session-api/test/lib/github.test.ts` — vitest with mocked `@octokit/rest`. Covers slug shape, octokit call payload, success path, rate-limit error mapping, name-collision error mapping.
- Modify: `services/session-api/package.json` — add dep `@octokit/rest`.
- Modify: `services/session-api/src/server.ts` (or wherever boot-time secret loading lives next to `loadOpencodeAuthHeader`) — at boot, read `OPENVOID_PLATFORM_GITHUB_ORG` from env *and* the `github-platform-creds.token` Secret from `openvoid-sessions` via the in-cluster K8s API. Cache the resulting token in process memory and pass it into the github helper module. Do **not** read the token from env (the Secret is cross-namespace from session-api's pod).

**Approach:**
- Octokit call: `octokit.rest.repos.createInOrg({ org, name, private: false, auto_init: false, description: \`openvoid app: \${prompt ?? "untitled"}\` })`.
- Slug rules: lowercase the prompt, replace any non-alphanumeric run with `-`, strip leading/trailing dashes, truncate at 40 chars; if empty, use `"app"`. Append `-` + 6 chars from `[0-9a-z]` (base32-like, no `i`/`o`/`l`/`1`/`0` to avoid ambiguity).
- Error mapping: octokit 422 (name-exists) → throw `RepoNameCollision`; 403 with `x-ratelimit-remaining: 0` → throw `GithubRateLimited`; other 4xx → throw `GithubClientError`; 5xx → throw `GithubServerError`. session-api route handler (U6) maps these to HTTP responses.
- Boot-time validation: if the `github-platform-creds` Secret cannot be read (missing, RBAC denied, missing `token` key) or `OPENVOID_PLATFORM_GITHUB_ORG` is unset, `services/session-api/src/server.ts` exits with a clear log (matching `loadOpencodeAuthHeader` pattern in `client.ts`).

**Patterns to follow:**
- Boot-time secret loading: see `loadOpencodeAuthHeader` in `services/session-api/src/k8s/client.ts`.
- Module structure: see existing `services/session-api/src/lib/scalar.ts` (sibling).
- Error envelope: stable `code` strings, consistent with `invalid_body` / `not_found` / `k8s_unavailable` in `routes/sessions.ts`.

**Test scenarios:**
- Happy path: `slugify("AI flashcards")` returns a string matching `/^ai-flashcards-[0-9a-z]{6}$/`.
- Happy path: `slugify(undefined)` returns a string matching `/^app-[0-9a-z]{6}$/`.
- Happy path: `slugify("")` returns a string matching `/^app-[0-9a-z]{6}$/`.
- Edge case: `slugify("$$$ super!!! cool")` returns a string matching `/^super-cool-[0-9a-z]{6}$/` (no leading/trailing dashes, no doubled dashes).
- Edge case: `slugify("a".repeat(100))` returns a string ≤ 47 chars (40 slug + dash + 6 suffix).
- Edge case: `slugify("---")` returns a string matching `/^app-[0-9a-z]{6}$/` (empty after strip → fallback).
- Edge case: `slugify("Café résumé")` returns ASCII-only (Unicode stripped, not transliterated, in v1).
- Happy path: `createAppRepo({ org: "openvoid-platform", baseName: "ai-flashcards-x7f2k9" })` calls `octokit.rest.repos.createInOrg` with the right payload and returns `{ repoName, htmlUrl, cloneUrl }` from the octokit response.
- Error path: octokit returns 422 → `createAppRepo` throws `RepoNameCollision` with the attempted name in the error message.
- Error path: octokit returns 403 with `x-ratelimit-remaining: 0` → `createAppRepo` throws `GithubRateLimited`.
- Error path: octokit network failure → `createAppRepo` throws `GithubServerError`.
- Covers AE4. Edge case: two concurrent calls with the same `baseName` produce two different slugs (the random suffix is generated per call, not per prompt).

**Verification:**
- `pnpm --filter @openvoid/session-api test` passes including the new file.
- Manual: `services/session-api/scripts/manual-repo-create.ts` (optional dev script, can be ad-hoc) creates a repo against a test org and prints the URL.

---

### U6. session-api: new-app `POST /sessions` path + idempotency

**Goal:** Wire the new `mode: "new-app"` request path: validate, slugify, create the repo, then create the pod with workspace-init configured for new-app mode (template URL + new repo URL + prompt). Add idempotency keyed on `Idempotency-Key` header to dedupe repo creation.

**Requirements:** R1, R2, R3, R7.

**Dependencies:** U1 (workspace-init naming), U4 (protocol), U5 (github helper).

**Files:**
- Modify: `services/session-api/src/routes/sessions.ts` — branch in `POST /sessions` on `mode`:
  - `import-repo`: existing behavior unchanged.
  - `new-app`: call `slugify(prompt)` → `createAppRepo({ org, baseName })` → call `sessionOps.createSessionResources({ sessionId, image, repo: cloneUrl, branch: "main", scaffoldTemplate: SCAFFOLD_TEMPLATE_URL, prompt, isNewApp: true })`.
  - Add idempotency check at the top of the handler: if `Idempotency-Key` header is present and matches an in-memory cache entry younger than 5 min, return the cached session payload (whether the prior call succeeded or is still in flight).
- Modify: `services/session-api/src/k8s/client.ts` — extend `SessionSpec` and `createSessionResources` signature with `scaffoldTemplate?: string`, `prompt?: string`, `isNewApp?: boolean`. In `buildSessionPodManifest`, when `isNewApp`, set env on `workspace-init`: `OPENVOID_NEW_APP=true`, `SCAFFOLD_TEMPLATE_URL`, `SCAFFOLD_PROMPT`, plus the existing `REPO_URL` (now = the newly-created repo URL) and `GIT_TOKEN` (now mounted from a different Secret since the new repo lives under the platform org — see Approach).
- Create: `services/session-api/src/lib/idempotency.ts` — small TTL LRU keyed on `Idempotency-Key`. 5-min TTL, bounded at 1000 entries.
- Create: `services/session-api/test/lib/idempotency.test.ts` — vitest.
- Modify: `services/session-api/test/routes.sessions.test.ts` — add new-app path test cases.

**Approach:**
- The platform org's PAT (in `github-platform-creds`) needs to be available *to the git push from inside workspace-init*, not just to session-api at repo-create time. Option A: mount `github-platform-creds` onto workspace-init for new-app pods (replacing `git-creds`'s mount for that pod's init container). Option B: session-api generates a short-lived deploy key. Choose A for v1 simplicity; preserve the per-container Secret-mount-discipline guard.
- The `Idempotency-Key` cache stores `{ status, result: { sessionId, repoUrl } | null }`. While `status === "in-flight"`, concurrent calls return `409 Conflict` with a hint to retry. While `status === "completed"`, return the cached result.
- On `RepoNameCollision`: very rare (random suffix), but if it happens, retry slugify+createAppRepo up to 3 times before surfacing as 500. Log with a metric.
- On `GithubRateLimited`: return 503 with `Retry-After` header and a clear error code `github_rate_limited`.

**Patterns to follow:**
- Type-guard validation (`isCreateRequest`) and uniform error envelope from existing `routes/sessions.ts`.
- Pod-create rollback on partial failure already exists in `K8sSessionOps.createSessionResources`; this unit extends but does not change the rollback shape.

**Test scenarios:**
- Covers AE1. Happy path: POST `{ mode: "new-app", prompt: "todo list with reminders" }` with `Idempotency-Key: abc` → 201 with `sessionId`, `status: "Pending"`, `pendingPhase: "provisioning"`; mock github helper records `createAppRepo({ baseName matching /^todo-list-with-reminders-[0-9a-z]{6}$/ })`; pod manifest sent to K8s mock has workspace-init env `OPENVOID_NEW_APP=true`, `SCAFFOLD_TEMPLATE_URL`, `SCAFFOLD_PROMPT="todo list with reminders"`, `REPO_URL=<new repo URL>`.
- Happy path: POST same request with same `Idempotency-Key` within 5 min → 201 returns the cached sessionId; mock github helper called once total.
- Happy path: POST same prompt with *different* `Idempotency-Key` → second 201 with different sessionId; github helper called twice (two different slugs due to random suffix).
- Edge case: POST `{ mode: "new-app" }` (no prompt) → 201; baseName matches `/^app-[0-9a-z]{6}$/`; `SCAFFOLD_PROMPT` env is empty string.
- Edge case: POST `{ mode: "import-repo", repo: "https://github.com/foo/bar.git" }` → existing behavior preserved; mock github helper NOT called; workspace-init env has `OPENVOID_NEW_APP` unset/false.
- Error path: github helper throws `GithubRateLimited` → 503 with `Retry-After`; idempotency cache marks the key as failed; pod NOT created.
- Error path: github helper throws `RepoNameCollision` once, then succeeds on retry → 201 with sessionId.
- Error path: github helper throws `RepoNameCollision` 3 times → 500 with `code: "repo_name_collision"`.
- Error path: github helper succeeds but pod-create fails → `createSessionResources` rolls back the pod; the GitHub repo remains (orphaned, accepted in v1); error returned to caller as `k8s_unavailable`.
- Regression: existing import-repo tests (Secret mount discipline, ownerRef, ingress shape) all pass unchanged.

**Verification:**
- All `services/session-api/test/` files pass.
- Manual smoke against kind: POST `{ mode: "new-app", prompt: "fizzbuzz" }` returns a sessionId; `kubectl get pods -n openvoid-sessions` shows a pod with a workspace-init initContainer carrying the new env vars.

---

### U7. workspace-init script: new-app branch

**Goal:** Make the init container's script branch on `OPENVOID_NEW_APP`: when set, perform the scaffold-seed flow; when unset, perform today's clone-existing-repo flow. Same image, same Secret-mount discipline.

**Requirements:** R7.

**Dependencies:** U1 (rename), U3 (template repo exists on platform org).

**Files:**
- Rename: `infra/images/workspace-init/clone.sh` → `infra/images/workspace-init/init.sh`.
- Modify: `infra/images/workspace-init/init.sh` — top-level branch: `if [ "$OPENVOID_NEW_APP" = "true" ]; then run_new_app; else run_import_repo; fi`. `run_import_repo` is today's clone logic verbatim. `run_new_app`:
  1. `git clone "$SCAFFOLD_TEMPLATE_URL" /workspace/repo` — uses anonymous HTTPS clone since the scaffold template is public.
  2. `cd /workspace/repo && rm -rf .git`.
  3. `git init && git checkout -b main`.
  4. `git remote add origin "$REPO_URL"` (where `REPO_URL` is the newly-created platform-org app repo URL).
  5. Write `app/scaffold-meta.json` with `{ prompt: "$SCAFFOLD_PROMPT", createdAt: "$(date -Iseconds)", scaffoldVersion: "v1" }` using a shell-safe JSON-write (jq if available; otherwise printf with escaping).
  6. `git config user.email`, `user.name` to a platform identity (e.g. `openvoid-bot@openvoid.dev` / `openvoid scaffold`).
  7. `git add -A && git commit -m "Initial commit from scaffold-react-rr7"`.
  8. `git push -u origin main` using `GIT_TOKEN` injected at the `https://x-access-token:$GIT_TOKEN@github.com/...` URL form (same pattern as today's clone.sh).
  9. `pnpm install` (relies on pnpm being installed in the workspace-init image — see Approach).
  10. Group-writable perms (`chgrp -R 0 . && chmod -R g+w .` + setgid on dirs), same as today.
- Modify: `infra/images/workspace-init/Dockerfile` — base image becomes `node:20-alpine` + `git` + `pnpm` (replaces today's `alpine/git`). Add `corepack enable && corepack prepare pnpm@9 --activate`.
- Modify: `services/session-api/src/k8s/client.ts` — switch the Secret mount on **both `workspace-init` and `git-finalizer`** from `git-creds` to `github-platform-creds` *when `isNewApp` is true*. For import-repo, both keep mounting `git-creds` (today's behavior). New-app pods write back to the platform-org app repo at session-end; a user-side `git-creds` token would 403 against that repo (it lives under the platform org), so the finalizer must use the same platform PAT as workspace-init. Implement as two pod-spec branches in `buildSessionPodManifest`, or a unified spec with conditional `envFrom` per container. Preserve the existing Secret-mount-discipline guard tests (`git-creds` / `github-platform-creds` mounted only on init + finalizer, never on the agent main container).

**Approach:**
- The image's base bump from `alpine/git` to `node:20-alpine` is necessary because `pnpm install` happens inside the init container. Cost: larger image (~150 MB vs ~20 MB), one-time pull per kind cluster. Acceptable.
- `node:20-alpine` does not ship pnpm. The Dockerfile must `RUN corepack enable && corepack prepare pnpm@9 --activate` and also `RUN apk add --no-cache git` (the node-alpine base ships node but not git).
- The SCC-friendly ownership pattern from the May-3 helm-routing learning applies here: ensure `node_modules` and any pnpm cache are group-writable so the agent's fsGroup can read them.
- The script stays POSIX-shell-compatible (`#!/bin/sh`): `node:20-alpine` ships ash, not bash, and we don't want to add bash to this image just for a script that has no bash-only constructs. JSON write uses `printf` with explicit shell escaping (no jq dep); preserve the existing token-sanitisation discipline from today's clone.sh.
- New-app Secret mount: `github-platform-creds` provides the token used for the `git push`. The mount happens via env `GIT_TOKEN: { valueFrom: { secretKeyRef: { name: github-platform-creds, key: token } } }` — same shape as today's `git-creds`, different Secret.

**Patterns to follow:**
- Token injection into HTTPS URL: see today's `infra/images/git-clone/clone.sh` (sanitised on-disk remote after push).
- Group-writable perms + setgid pattern: today's clone.sh.
- Init-container env injection: today's `services/session-api/src/k8s/client.ts:286–319`.

**Test scenarios:**
- Test expectation: script-level — there is no unit-test harness for the init scripts today (they're shell). Behavior verified end-to-end via U9's manifest tests + manual kind smoke. Add a small `init.sh --dry-run` mode or a separate `scripts/test-init-sh.sh` only if the script grows beyond ~80 LOC; in v1, keep it script-shaped.
- Manifest-level (asserted in U6 tests): when `isNewApp: true`, workspace-init env contains `OPENVOID_NEW_APP=true`, `SCAFFOLD_TEMPLATE_URL`, `SCAFFOLD_PROMPT`; when `isNewApp` unset/false, env contains today's vars only.
- Regression: workspace-init image builds (`docker build infra/images/workspace-init/`) and the resulting image runs the import-repo path correctly against a known test repo (manual smoke).

**Verification:**
- Manual smoke against kind: `tilt up`, POST a new-app session, watch `kubectl logs <pod> -c workspace-init -f` show the scaffold-seed steps in order, then `pnpm install`, exit 0. Confirm the new repo on github shows the initial commit with `app/scaffold-meta.json` populated.
- Manual smoke: existing import-repo session still works (clone + perms + exit 0).

---

### U8. Agent container: `pnpm dev` alongside OpenCode + readinessProbe

**Goal:** The agent container runs `pnpm dev` and `opencode serve` as siblings under the existing entrypoint; Kubernetes' `readinessProbe` on port 3000 gates pod-Ready on the dev server actually responding.

**Requirements:** R8, R9.

**Dependencies:** U1.

**Files:**
- Modify: `infra/images/opencode/entrypoint.sh`:
  - Add a launch of `pnpm dev` as a backgrounded child *before* `opencode serve`, with stdout/stderr piped to clearly-labeled prefixes.
  - Add a SIGTERM trap that forwards to both PIDs (`kill -TERM $DEV_PID $OPENCODE_PID`).
  - Use `wait -n` to exit when the first child dies (so a dev-server crash doesn't keep a half-broken pod alive).
  - Preserve the existing `OPENCODE_SERVER_PASSWORD` check at top — exit 1 if unset.
- Modify: `infra/images/opencode/Dockerfile` — the existing base is `node:20-alpine` which ships **ash, not bash**, and does **not** ship pnpm. Add both unconditionally:
  - `RUN apk add --no-cache bash` so `#!/bin/bash` + `wait -n` work.
  - `RUN corepack enable && corepack prepare pnpm@9 --activate` so `pnpm dev` resolves.
  - Set `WORKDIR /workspace/repo` (or invoke pnpm with `--dir /workspace/repo`) so the dev server starts in the workspace mount populated by workspace-init.
  Without these installs, the entrypoint script will not start and the agent container will CrashLoopBackOff on first boot.
- Create: `infra/images/opencode/instructions/scaffold-extend.md` — agent guidance: explanation of the scaffold layout, explicit "extend rather than rebuild" rule, mention of `app/scaffold-meta.json` as the surface that holds the user's prompt, request that the agent treat `app/routes/_index.tsx` as the starting canvas. The OpenCode container's existing convention for shipping instructions (see existing `dev-server-bind.md`) is followed.
- Modify: `services/session-api/src/k8s/client.ts` — add `readinessProbe` to the agent container in `buildSessionPodManifest`:
  ```
  readinessProbe:
    httpGet: { port: 3000, path: "/" }
    initialDelaySeconds: 5
    periodSeconds: 3
    timeoutSeconds: 2
    failureThreshold: 30
  ```
  (initialDelay accounts for OpenCode + pnpm dev cold start; failureThreshold * periodSeconds = 90s ceiling before pod is marked NotReady, which is enough for cold install paths that surface dev-server boot late.)

**Approach:**
- Two-process bash entrypoint pattern. **`$!` after a piped command captures the PID of the final pipeline stage (`sed`), not the leader — the trap would forward SIGTERM to `sed`, not pnpm/opencode.** Use process substitution (or named FIFOs) to keep the leader as the foreground process whose PID `$!` captures:
  ```
  #!/bin/bash
  set -euo pipefail
  pnpm --dir /workspace/repo dev > >(sed 's/^/[dev] /') 2>&1 &
  DEV_PID=$!
  opencode serve --port 8080 --workspace /workspace/repo > >(sed 's/^/[agent] /') 2>&1 &
  OPENCODE_PID=$!
  trap 'kill -TERM $DEV_PID $OPENCODE_PID 2>/dev/null || true' TERM INT
  wait -n $DEV_PID $OPENCODE_PID
  EXIT_CODE=$?
  kill -TERM $DEV_PID $OPENCODE_PID 2>/dev/null || true
  wait
  exit $EXIT_CODE
  ```
  Process substitution requires bash (already installed in the Dockerfile change above). `wait -n $DEV_PID $OPENCODE_PID` blocks until one of the named children exits and surfaces its exit code so the pod's CrashLoopBackOff carries a meaningful status rather than always-0.
- The readinessProbe is `httpGet` on `/` rather than `tcpSocket`: catches the case where Vite is listening but the framework hasn't finished its initial route registration. Trade-off: any 5xx from the index route fails readiness; in v1 that's acceptable because the scaffold's index route is trivial.
- `pnpm dev` cwd is `/workspace/repo` — set in Dockerfile WORKDIR or `--dir`. The workspace volume is mounted at `/workspace`; workspace-init populates `/workspace/repo`.

**Patterns to follow:**
- Existing entrypoint script shape in `infra/images/opencode/entrypoint.sh`.
- `infra/images/opencode/instructions/dev-server-bind.md` — pattern for shipping agent instructions baked into the image.

**Test scenarios:**
- Manifest assertion (in U9 tests, since session-api change): agent container has a `readinessProbe` with `httpGet` on port 3000, `initialDelaySeconds: 5`, `failureThreshold: 30`.
- Manifest assertion: agent container's command/args are unchanged (entrypoint script handles everything internally).
- Manual smoke against kind: agent container starts, `kubectl describe pod` shows readinessProbe failing for the first 5-30s, then succeeding; `kubectl get pod` shows Ready 1/1 once dev server is up.
- Manual smoke: kill `pnpm dev` inside the pod (`kubectl exec -- pkill -f vite`) → `wait -n` returns → entrypoint kills opencode → pod transitions to NotReady → eventually CrashLoopBackOff. This is the *correct* failure shape for v1 (preview broken = session broken).

**Verification:**
- Pod manifest produced by `buildSessionPodManifest` includes the readinessProbe on the agent container.
- Manual kind smoke: new-app session creates a pod that becomes Ready within ~30s of workspace-init completing.

---

### U9. Session status: gate Running on probe + emit `pendingPhase`

**Goal:** session-api maps pod's init-container status and `Ready` condition to `status` and `pendingPhase` on the Session response. The storyboard's real-signal contract is satisfied here.

**Requirements:** R8, R10.

**Dependencies:** U4 (protocol), U6 (new-app path), U7 (workspace-init env contract), U8 (readinessProbe).

**Files:**
- Modify: `services/session-api/src/routes/sessions.ts` (or wherever `GET /sessions/:id` is handled) — derive `status` and `pendingPhase` from `pod.status`:
  - If pod doesn't exist → `Stopped` (existing) or `not_found` (existing).
  - If pod's phase is `Pending` and `workspace-init` initContainer's `state` is `Running` → `status: "Pending"`, `pendingPhase: "seeding-scaffold"` initially, `"installing-deps"` once a heuristic indicator says so (see Approach for the heuristic).
  - If pod's phase is `Pending` and `workspace-init` initContainer's `state` is `Terminated` with exit 0, and `git-finalizer` initContainer's `state` is `Running` (the native sidecar) — the agent container starts → `status: "Pending"`, `pendingPhase: "awaiting-dev-server"`.
  - If pod's phase is `Running` and the agent container's readiness condition is `False` → `status: "Pending"`, `pendingPhase: "awaiting-dev-server"`.
  - If pod's phase is `Running` and the agent container's readiness is `True` but ingress URLs aren't populated yet → `status: "Pending"`, `pendingPhase: "running-pre-ingress"` (today's behavior, preserved).
  - If pod's phase is `Running`, readiness `True`, and ingress URLs populated → `status: "Running"`, no `pendingPhase`.
  - **Failure mapping:** If any init container terminated non-zero, the agent container is in `CrashLoopBackOff`, or the readinessProbe has been failing past the `failureThreshold` ceiling → `status: "Failed"` with `error: { code, message }`. `code` values: `init_failed` (workspace-init exited non-zero), `agent_crashloop` (agent container restart-count > 0 and not currently ready), `dev_server_unhealthy` (probe failed past ceiling without a restart). The `message` field is intended for logs/telemetry; landing maps `code` → user-facing copy in `derive.ts` (see U10) and does not render `message` directly.
- Modify: `services/landing/app/utils/derive.ts` — extend the `View` discriminator to map `pendingPhase` → storyboard active step (1..5). Update `gateOnIngressReadiness` to defer to the new server-side `running-pre-ingress` phase (no client-side change to ingress probing — server controls the signal).

**Approach:**
- Distinguishing `seeding-scaffold` from `installing-deps` from a single init-container's life is the hard part. Two viable approaches:
  - **(a) Coarse:** treat the whole workspace-init container as one phase (`seeding-and-installing`). Storyboard collapses steps 2 and 3 visually or holds at step 2 until init finishes. Simplest; user sees fewer mid-step transitions but each transition is real.
  - **(b) File-marker:** workspace-init script touches `/workspace/.seed-done` after step 8 (push), and `/workspace/.install-done` after step 9. session-api reads them via `kubectl exec` on the init container. Most accurate; introduces an exec dependency.
- Pick **(a)** for v1. The brainstorm's R10 says "wired to real signals", not "one signal per step"; AE2 is solely about the final probe. Storyboard advances steps 1 → 2-3 (combined "Cloning + installing") → 4 → 5 with real transitions.
- The five `pendingPhase` enum values are kept in the protocol even if v1 only uses four of them — the unused fifth (`installing-deps`) is reserved for the v1.5 file-marker upgrade.

**Patterns to follow:**
- Existing pod-phase → session-status mapping in `services/session-api/src/routes/sessions.ts` (today: `Running` phase = `Running` status).
- Discriminated-view pattern in `services/landing/app/utils/derive.ts`.

**Test scenarios:**
- Covers AE2. Happy path (session-api unit): mock pod with `phase: "Pending"`, `initContainerStatuses: [{ name: "workspace-init", state: { running: {} } }]` → response has `status: "Pending"`, `pendingPhase: "seeding-scaffold"`.
- Happy path (session-api unit): mock pod with `phase: "Running"`, `containerStatuses: [{ name: "session", ready: false }]` → `status: "Pending"`, `pendingPhase: "awaiting-dev-server"`.
- Happy path (session-api unit): mock pod with `phase: "Running"`, `containerStatuses: [{ name: "session", ready: true }]`, ingress URLs populated → `status: "Running"`, no `pendingPhase`.
- Edge case (session-api unit): mock pod with `phase: "Running"`, session container ready, ingress URLs *not* populated → `status: "Pending"`, `pendingPhase: "running-pre-ingress"` (preserves today's behavior).
- Edge case (session-api unit): mock pod with `phase: "Pending"`, all init containers terminated with non-zero exit → `status: "Failed"`, no `pendingPhase`.
- Happy path (landing unit, `derive.ts`): `Session { status: "Pending", pendingPhase: "seeding-scaffold" }` → `View { kind: "provisioning", activeStep: 1 }`.
- Happy path (landing unit): `Session { status: "Pending", pendingPhase: "awaiting-dev-server" }` → `View { kind: "provisioning", activeStep: 3 }`.
- Happy path (landing unit): `Session { status: "Running" }` → `View { kind: "ready" }`.

**Verification:**
- All session-api + landing tests pass.
- Manual smoke: create a new-app session, watch the status endpoint cycle through the pending phases in order before flipping to Running.

---

### U10. Landing: new-app entry point + storyboard rewired

**Goal:** Drop the controller-side `OPENVOID_DEFAULT_REPO` injection and send `mode: "new-app"` + the user's prompt from the existing home-page form (the page already has a primary `<textarea>` form — no CTA rebuild is needed). Storyboard advances steps based on server-supplied `pendingPhase` instead of the synthetic 25s timer. Add a `failed` view kind so sessions that error during init render a deterministic error state instead of an empty `provisioning` shell.

**Requirements:** R1, R10.

**Dependencies:** U4 (protocol shape), U6 (new-app route), U9 (status discriminator).

**Files:**
- Modify: `services/landing/app/actions/home/page.tsx` — light copy/affordance tweaks only. The page already renders a primary `<textarea>` form bound to the prompt; verify the placeholder reads "Describe what you want to build…" and the submit label reads "Start a new app", and confirm the existing `name="prompt"` attribute matches what the controller will forward. The four `data-coming-soon` alt cards (`Start from a template`, `Import GitHub repo`, `Upload codebase`, `Fork an example`) stay `data-coming-soon` — none are activated by this plan.
- Modify: `services/landing/app/actions/home/controller.tsx` — remove the `formData.set('repo', OPENVOID_DEFAULT_REPO)` injection. Instead: set `mode: "new-app"`, forward `prompt` from the form. Validate `prompt` is ≤ 500 chars (UI hint) but accept empty. Continue to use `Idempotency-Key`. This is the load-bearing change in U10; the page-level edits above are cosmetic.
- Modify: `services/landing/app/utils/api.ts` — `createSession` payload now includes `mode` and optional `prompt`; type changes flow from regenerated protocol types (U4). Drop the always-injected `repo`.
- Modify: `services/landing/app/utils/derive.ts` — add a third `View` discriminant `{ kind: "failed", reason: string, retryHref: string }`. Map `Session { status: "Failed" }` (the state U9 emits when init containers terminate non-zero, the dev server crashes loop, or GitHub credentials fail) to this view. `reason` carries human copy derived from the session-api error envelope (see Approach); `retryHref` points back to `/` so the user can start a fresh session.
- Modify: `services/landing/app/actions/sessions/components/` — add a `failed.tsx` component rendering the `failed` view: short title ("That session didn't start."), one-line reason, primary "Start a new session" button → `retryHref`, secondary "Tell us what happened" link to the support surface. Layout follows the May-10 layout-primitive composition pattern (one outer max-width, one Stack), same as `ready.tsx`.
- Modify: wherever `View` is dispatched into a rendered component (today the home/session action route picks `ready.tsx` vs the provisioning surface) — add the `failed` branch dispatching to the new component. Failing to add this branch will throw on an exhaustive discriminator check; failing to add it without the check will render a blank screen on every session failure.
- Modify: `services/landing/app/actions/sessions/components/provisioning.tsx` — step labels updated to match R10's boot-sequence table:
  - `Allocating sandbox` → unchanged (matches step 1 `provisioning`)
  - `Cloning starter template` → unchanged (matches step 2 `seeding-scaffold`)
  - `Installing dependencies` → unchanged (matches step 3, currently collapsed with step 2 per U9 approach (a))
  - `Booting agent` → unchanged (matches step 4 `awaiting-dev-server`)
  - `Mounting preview server` → relabel to "Starting preview server" (matches R10 wording; current label is fine semantically but plan-table uses "Starting dev server")
- Modify: `services/landing/app/actions/sessions/client/provisioning-storyboard.tsx`:
  - Drop the seeded random per-step durations and the ~25s fixed timer.
  - Accept `activeStep` and `pendingPhase` as new props (server-derived per U9).
  - Bar fill animates between received step indices; ETA shows generic copy (e.g. "Setting up your sandbox…") rather than a precise countdown.
  - Preserve the existing "taking longer than usual" degradation when the same step is active for > 60s.
  - DOM contract unchanged (`#step-N`, `#bar-fill`, `[data-storyboard]`).
  - `degradeAt` and `TOTAL_SECONDS` constants either removed or repurposed for the new "stuck" detection.
- Modify: `services/landing/test/actions/sessions/client/provisioning-storyboard.test.tsx` — replace tests of synthetic-timer math with tests of pendingPhase → step mapping and bar-fill behavior on phase change.

**Approach:**
- The home page already composes via the canonical Remix 3 layout primitives (one outer max-width, one Stack) per the May-10 learning. No structural rework — U10's home-page edits are limited to placeholder/label copy and forwarding the `prompt` formData field.
- The new `failed.tsx` component does compose from layout primitives — reference `app/actions/sessions/components/ready.tsx`.
- Use `value=` (not `defaultValue=`) on any new `<textarea>` per the May-6 attribute-naming learning. Initial content is rendered as a child if needed.
- Prompt validation is light — empty is OK (falls back to `app-<suffix>` slug); long is truncated server-side via `slugify`.
- The storyboard's "synthetic micro-progress within a step" idea is dropped for v1. Steps advance when the server signals; in between, the bar shows a settled state. Simpler than the seeded timer, more honest.
- `failed.reason` copy: derive in `derive.ts` from the session-api error envelope. Map well-known `code` values to short user-facing strings ("GitHub couldn't create the repo right now — try again in a minute." for `github_rate_limited`; "We couldn't reach the cluster to start your sandbox." for `k8s_unavailable`; "Something went wrong setting up your sandbox." as the generic fallback). Do not leak raw error messages or HTTP status codes.

**Patterns to follow:**
- Layout primitives composition: `services/landing/app/actions/sessions/components/ready.tsx` (May-10 learning).
- Remix 3 HTML attribute care: May-6 learning.
- Test runner: `remix/test` (not vitest) for landing tests.

**Test scenarios:**
- Happy path (controller test): POST form with `prompt: "fizzbuzz"` → controller calls Session API with `{ mode: "new-app", prompt: "fizzbuzz" }`; no `repo` field sent.
- Happy path (controller test): POST form with no prompt → controller calls Session API with `{ mode: "new-app" }`; no `prompt`, no `repo`.
- Edge case (controller test): POST form with prompt = 700 chars → controller truncates to 500 char hint, sends full string to Session API (slug truncation is server-side).
- Edge case (controller test): regression — without `mode` set, the call still works (defaults to "new-app" in v1 since there is no UI path for "import-repo" yet).
- Happy path (storyboard unit): `<ProvisioningStoryboard activeStep={2} pendingPhase="seeding-scaffold" />` renders step 2 as active, steps 0–1 as complete, step 3+ as pending.
- Happy path (storyboard unit): bar-fill width transitions when `activeStep` changes from 1 to 2.
- Edge case (storyboard unit): a session that's been at the same `activeStep` for >60s renders the "taking longer than usual" message — and stays there until the step advances.
- Happy path (derive.ts test, U9 territory but cited here): `pendingPhase: "seeding-scaffold"` maps to `activeStep: 1` in the view.
- Happy path (derive.ts test): `Session { status: "Failed", error: { code: "github_rate_limited", ... } }` → `View { kind: "failed", reason: "GitHub couldn't create the repo right now — try again in a minute.", retryHref: "/" }`.
- Happy path (derive.ts test): `Session { status: "Failed", error: { code: "k8s_unavailable", ... } }` → `View { kind: "failed", reason: "We couldn't reach the cluster to start your sandbox.", retryHref: "/" }`.
- Edge case (derive.ts test): `Session { status: "Failed", error: { code: "unknown_code", message: "raw boom" } }` → `View { kind: "failed", reason: "Something went wrong setting up your sandbox.", ... }` (generic fallback, no raw message leak).
- Happy path (failed.tsx component test): renders the reason, the retry button → `retryHref`, and the secondary support link; no axe a11y violations.
- Visual: Playwright/manual visual check (no formal test in v1) — the home-page form copy/affordances and the new `failed.tsx` render correctly across mobile + desktop viewports.

**Verification:**
- `pnpm --filter @openvoid/landing test` passes.
- Manual smoke against kind: visit landing → type a prompt → submit → observe Provisioning storyboard advance through real phases → land on the scaffold's index-route empty state showing the prompt.

---

## System-Wide Impact

- **Interaction graph:** Landing controller ↔ Session API ↔ GitHub REST ↔ K8s API ↔ pod (workspace-init initContainer + agent container with pnpm dev). New nodes: GitHub REST (session-api → github.com), readinessProbe (K8s → pod port 3000). Existing nodes (landing poller, ingress) unchanged in topology.
- **Error propagation:** GitHub rate-limit / 5xx → session-api 503 with `Retry-After` (synchronous; surfaced to landing's POST handler). Repo-name collision (after 3 retries) → 500 with `code: "repo_name_collision"`. Once a session exists, failures surface on `GET /sessions/:id` as `status: "Failed"` with `error: { code, message }` per U9: `init_failed`, `agent_crashloop`, `dev_server_unhealthy`. Landing's `derive.ts` maps `code` → user-facing copy and renders the new `failed` view (U10). All failures preserve the uniform `{ code, message }` envelope shape.
- **State lifecycle risks:** Pod-orphan on partial failure (GitHub repo created but pod-create rolls back) — accepted in v1, runbook only. Idempotency cache is per-process and lost on session-api restart — short-lived 5-min TTL bounds the window for double-create after a restart.
- **API surface parity:** `mode: "import-repo"` continues to work unchanged. The existing `repo` request field becomes conditional, not removed. Existing clients (no current external consumers beyond `services/landing`) are unaffected as long as they pass `mode`.
- **Integration coverage:** End-to-end kind smoke verifies the full boot path (covered in U6 + U9 manual verification). Unit tests cannot prove the workspace-init script's actual `git push` works — that's a kind-integration concern. Add an `INTEGRATION=1` test in `services/session-api/test/integration/` that exercises the new-app flow against a real (test) platform org and asserts the resulting repo exists + has the expected `app/scaffold-meta.json` content.
- **Unchanged invariants:** Secret mount discipline preserved — for import-repo pods, `git-creds` mounts only on workspace-init + git-finalizer (never on agent main); for new-app pods, `github-platform-creds` takes that slot on *both* workspace-init and git-finalizer (the finalizer's terminal `git push` targets the platform-org repo and cannot use a user-side token). `opencode-auth` Secret mount discipline (only on agent container, never on init/finalizer) is preserved unconditionally. Ingress shape, ownerRef cascading delete, idle-timeout SIGTERM handling — all unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Platform GitHub org PAT scope is wrong on first try (commonly missed: `Administration: write` is hidden under "Repository permissions" → "Administration" in the new PAT UI). | Runbook `docs/runbooks/platform-github-org-setup.md` includes a screenshot/checklist of required scopes; session-api logs a clear error and exits at boot if the `github-platform-creds.token` Secret cannot be read or 401s on a probe call. |
| `wait -n` + process substitution are bash-only and the OpenCode base (`node:20-alpine`) ships ash, not bash. | U8 unconditionally installs `bash` via `apk add` and unconditionally enables `pnpm` via `corepack`. Verified at image-build time, not deferred. |
| Vite dev server cold-start exceeds the readinessProbe ceiling (90s with current `failureThreshold * periodSeconds`). | Use a generous `failureThreshold: 30` with `periodSeconds: 3`; tune in U8 based on observed kind boot times. |
| Token leak in workspace-init logs (e.g. `git push` printing the credential URL). | Mirror today's clone.sh discipline: token never appears in `set -x` output; remote URL is sanitized post-push as today. |
| Multiple session-api replicas → idempotency cache miss (key lands on different replica than the original call). | v1 explicitly runs single-replica. Document in `docs/runbooks/platform-github-org-setup.md`. Distributed idempotency tracked for v1.5. |
| The `scaffold-react-rr7` template repo's `pnpm-lock.yaml` drifts from the React Router v7 version that ships next year. | The scaffold repo is an artifact under operator control; treat lockfile updates as a versioned event. Plan track: capture an RR7 / Vite-in-pod learning to `docs/solutions/` once the scaffold is in real use. |
| The `allowedHosts: true` setting in the scaffold's `vite.config.ts` is the existing v1-plan DNS-rebinding concern (line 1356). | Accepted as-is in v1; tightening to a per-session host allowlist tracked at v1-plan level, not here. |
| OpenCode's behavior on the soft README constraint is unverified — origin's R6 Deferred-to-Planning item. | Belt-and-suspenders mitigation: ship the same instructions in both the scaffold's `README.md` and `infra/images/opencode/instructions/scaffold-extend.md`. Validate behavior empirically once landed; capture findings as a `docs/solutions/` entry. |

---

## Documentation / Operational Notes

- New runbook: `docs/runbooks/platform-github-org-setup.md` — one-time operator setup for the platform GitHub org and PAT.
- New scaffold doc: `docs/scaffolds/react-rr7-minimum.md` — describes what `openvoid-platform/scaffold-react-rr7` contains; updated when the scaffold's structure evolves.
- README in this repo: do *not* update `README.md`'s phase-status block — it's already stale (claims Phase 3 in-progress while we're at end-of-Phase-7). A separate cleanup is warranted but is out of scope.
- After implementation, capture `docs/solutions/` entries for: RR7 framework mode in K8s, Vite-in-pod `allowedHosts` + port-binding, octokit auth/scope choices, the protocol-change workflow, and the dual-process bash entrypoint pattern. Each is candidate fodder for `/ce-compound`.
- Monitoring: no new metrics in v1. After launch, watch (manually) for: GitHub rate-limit 503s in session-api logs, repo-name-collision retries (should be < 0.001%), workspace-init runtime trend, dev-server cold-start trend.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-12-coding-session-scaffold-bootstrap-requirements.md](docs/brainstorms/2026-05-12-coding-session-scaffold-bootstrap-requirements.md)
- **v1 plan context:** [docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md](docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md) (Phase 4–8 for K8s + landing architecture; line 1356 for the `allowedHosts` concern; line 173 for the earlier-deferred "agent-prompt / project-templates location" question this plan partially resolves)
- **Provisioning Hi-Fi plan (just merged):** [docs/plans/2026-05-12-001-feat-provisioning-hi-fi-plan.md](docs/plans/2026-05-12-001-feat-provisioning-hi-fi-plan.md)
- **Learnings:**
  - [docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md](docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md) — pod-loopback / nip.io trap
  - [docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md](docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md) — cluster-fabric differences
  - [docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md](docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md) — layout primitives
  - [docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md](docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md) — Remix 3 SSR attribute pitfall
- **Related code (canonical entry points):**
  - `services/session-api/src/k8s/client.ts` — manifest builder + constants
  - `services/session-api/src/routes/sessions.ts` — request handlers
  - `services/landing/app/actions/sessions/client/provisioning-storyboard.tsx` — storyboard
  - `infra/images/git-clone/` (renamed to `workspace-init/` in U1) — init container source
  - `infra/images/git-finalizer/entrypoint.sh` — terminal `git push` on session end; this plan adds `github-platform-creds` mount for new-app pods (see U7 + System-Wide Impact)
  - `infra/images/opencode/entrypoint.sh` — agent entrypoint
  - `packages/protocol/main.tsp` — TypeSpec source
