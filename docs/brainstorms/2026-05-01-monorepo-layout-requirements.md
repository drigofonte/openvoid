---
date: 2026-05-01
topic: monorepo-layout
revision: 3
---

# Monorepo Layout

## Problem Frame

openvoid is a greenfield open-source platform (Replit/v0/Lovable alternative) with three active component types: a Next.js Web UI, TypeScript backend services, and a Go Kubernetes operator. The repo currently contains only `LICENSE`. Without a deliberate monorepo shape, every later decision — contracts, CI, local dev, releases — is improvised, and polyglot coordination becomes a long-tail tax.

**Primary v1 audience: hosted-first.** openvoid is software the core team runs. Self-hosting is welcome but not first-class for v1. This decision sits upstream of the release model (SHA tags rather than semver), the no-CLI scope cut, and the IDL choice.

## v1 Milestone & Build Strategy

**The goal of v1 is to prove the coding-session lifecycle works end-to-end — not to ship a polished platform.** Concretely, v1 is "done" when a user can: open the local Web UI, click *Start Session*, see an OpenCode pod boot, prompt the agent to read/write/execute code from a real Git repo, see a live preview of what the agent built, leave the session idle, and watch the pod self-destroy after committing back to a `feat/<session-id>` branch.

**The implementer is a Kubernetes novice.** Comfortable with Docker; concepts of K8s understood; zero prior hands-on cluster work. v1 is therefore a learning exercise as much as a delivery exercise. This shapes both the build strategy (vertical slices, learn-by-doing) and the artifact tone (the plan should walk through every step from cluster creation onward).

**Build strategy: vertical slices, not horizontal infrastructure.** Each slice ends in a runnable, testable proof. The plan layers them roughly in this order — exact decomposition is a planning concern but the spine is fixed:

1. **Cluster bring-up** — kind locally; a DigitalOcean Kubernetes cluster remotely. Verify `kubectl get nodes` works on both.
2. **Hello-world pod** — deploy a trivial container, expose it via Service, verify with `kubectl port-forward` and `curl`.
3. **Session API skeleton** — the `services/session-api` workspace, with one OpenAPI endpoint that creates a Pod via the K8s client. Drive it manually from the OpenAPI page (Swagger/Scalar/Stoplight Elements). No CRD yet, no operator yet — just direct Pod creation.
4. **CodingSession CRD** — define the resource type. Now the API creates a `CodingSession` CR instead of a Pod directly. No reconciler logic yet; just the schema and `kubectl get codingsessions` working.
5. **Session Operator (skeleton)** — kubebuilder-scaffolded controller that reacts to CRs by creating/deleting Pods. Manual lifecycle: start, force-stop, idle-stop (timer-driven, no real activity tracking yet).
6. **Real OpenCode image** — replace the hello-world image with an OpenCode container that has bash/read/write/web-search tools. Connect to it (kubectl exec or WS via the API) and prompt it.
7. **Workspace + Git** — mount a PVC, populate it from an empty Git repo on first start, let the agent read/write/execute code in it.
8. **Commit-on-shutdown** — pre-stop hook (or operator-driven) that pushes a `feat/<session-id>` branch before the pod terminates.
9. **Web UI + live preview** — replace the OpenAPI page with `apps/web`. Add a simple session view, a chat box that streams agent output, and a second port that serves the agent's app under construction (live preview).

Each slice produces a concrete demo. Slices may simplify or skip structural maturity that the rest of this brainstorm pins (e.g., dependency-cruiser, nightly false-negative CI) — the plan decides where that complexity lands or is deferred.

## Component Map

```
                      ┌──────────────────┐
                      │   apps/web       │  Next.js Web UI
                      │   (TypeScript)   │
                      └────────┬─────────┘
                               │ HTTP / WS
                               ▼
                      ┌──────────────────┐
                      │ services/        │
                      │  session-api     │  REST/WS gateway, stateless
                      │ (TypeScript)     │  ─── translation boundary ───
                      └────────┬─────────┘
                               │ K8s API (CR ops)
                               ▼
                      ┌──────────────────┐         ┌────────────────┐
                      │ services/        │ watches │ CodingSession  │
                      │  session-operator│◄────────┤   CR (CRD)     │
                      │ (Go, kubebuilder)│         └────────────────┘
                      └──────────────────┘

                ┌─────────────────────────────┐
                │  packages/protocol          │
                │  TypeSpec → OpenAPI 3.1     │
                │  → TS clients/types         │
                │  (consumed by web + api)    │
                └─────────────────────────────┘

  infra/ (helm, argocd, crds) — versioned alongside code
```

The Session API is the explicit translation boundary between the user-facing API surface (TypeSpec/OpenAPI, consumed by Web UI) and the internal CRD surface (Go-authored, consumed by the operator). The two vocabularies are independent by design.

## Requirements

**Repo Shape**
- R1. Monorepo uses pnpm workspaces + Turborepo for the TypeScript surface; the Go operator lives in its own Go module under `services/session-operator/`. v1 has a single Go module — `go.work` is added if and when a second Go consumer appears.
- R2. Top-level workspace categories are `apps/`, `services/`, `packages/`, and `infra/`. No other top-level code directories are introduced in v1. The split anticipates v1.5+ additions (CLI, agent-templates, deploy-controller) rather than the v1 footprint alone.
- R3. v1 services are exactly: `apps/web`, `services/session-api`, `services/session-operator`. `services/deploy-controller` is **not** present in v1.
- R4. Workspace dependency rules are enforced and documented:
  - `apps/*` and `services/*` may depend on `packages/*`.
  - `packages/*` may depend on other `packages/*` but not on anything in `apps/` or `services/`.
  - No cross-service code imports. Session API and operator communicate only via the Kubernetes API.
  - Test code (fixtures, helpers, e2e suites) is subject to the same rules — shared test utilities live under `packages/` only if they have no service dependency.
  - Enforcement: dependency-cruiser (or equivalent) blocks violations in the TS dependency graph in CI. With a single Go module in v1, Go-side enforcement is structural-by-construction (no second module to import from). When `go.work` is added, replace this with an explicit Go enforcement mechanism (e.g., a CI grep over allowed import paths).

**Contracts & Codegen**
- R5. The HTTP/WS contract between the Web UI and Session API is authored in TypeSpec inside `packages/protocol/`. Generated artifacts in v1 are: OpenAPI 3.1 (canonical machine spec) and TypeScript clients/types. **No Go emission in v1** — the operator does not consume HTTP/WS contracts (it only watches CRs). Go emission is added when a Go consumer appears.
- R6. `CodingSession` CRD types are authored in Go (kubebuilder convention) inside `services/session-operator/`. CRD YAML is emitted to `infra/crds/` via `make manifests`. The CRD surface and the TypeSpec API surface are **independent vocabularies** and evolve independently.
- R7. The Session API is the **translation boundary** between API DTOs and CRD spec. Drift between overlapping concepts (session config, runtime selection, lifecycle states) is bounded by integration tests that POST to the API and assert the resulting CR matches expectations. No automated schema-compatibility check between the two surfaces in v1.
- R8. Generated artifacts are committed to the repo: TypeScript and OpenAPI artifacts under `packages/protocol/generated/`, CRD YAML under `infra/crds/`. CI verifies freshness by regenerating and diffing; out-of-date artifacts fail the build.

**Local Development**
- R9. The full local stack runs via kind + Tilt. A single `Tiltfile` at the repo root brings up the cluster contents (operator, session-api, web) with file-sync hot-reload for TS code and image rebuilds for the operator.
- R10. A new contributor can clone, run a single bootstrap command, open the local Web UI, start a session, and see OpenCode respond to a prompt. Time-to-ready is observed and improved over time, not gated by a hard target. Bootstrap requirements (Docker, kind, Tilt, Node, Go, pnpm) are documented in the repo root.
- R11. Operator unit tests run without a cluster (controller-runtime envtest); end-to-end tests run against kind.

**CI**
- R12. CI runs on every PR. Path filters skip jobs for unaffected workspaces. The TypeScript surface is driven by Turborepo's affected-task detection; the Go operator is a separate job triggered by changes under `services/session-operator/`, `infra/crds/`, or `infra/helm/`. (`packages/protocol/` is added as a trigger when Go emission is reintroduced.)
- R13. CI must verify on every PR: lint + typecheck + unit tests for affected workspaces, generated-artifact freshness (R8), Helm chart lint, and Kubernetes manifest validation (e.g., `kubeconform`). The kind-based end-to-end test (Web UI → API → CR → operator → ready pod) is **exempt from path filtering** and runs on every PR that touches code under `apps/`, `services/`, `packages/`, or `infra/`; docs-only PRs skip it.
- R14. A nightly CI job runs **all** jobs ignoring affected-detection. This catches false negatives in the affected-detection logic before they break `main`.

**Releases & Versioning**
- R15. Services (`apps/web`, `services/session-api`, `services/session-operator`) are released trunk-based: every merge to `main` builds a SHA-tagged image, pushes it to GHCR, and updates the image tag in the Helm values committed to `infra/helm/` (exact mechanism — CI write-back vs Argo CD Image Updater — deferred to planning). ArgoCD reconciles the resulting Git change. No semver tags on services in v1. Self-host operators tracking openvoid in v1 are expected to follow `main`.
- R16. Conventional Commits are used as the commit-message format to enable later automation. (No version-bump tooling in v1.)
- R17. *(Deferred)* Changesets and per-package semver are not part of v1. Add when the first publishable package exists. Bolting Changesets on later is one config file plus one CI job — there is no real "wire it up early" benefit.

## Success Criteria

**Milestone (the v1 outcome the monorepo must enable):**
- A user can open the local Web UI, start a session, prompt the OpenCode agent to read/write/execute code in a real Git repo, see a live preview of the running app, leave the session idle, and observe the pod self-destroy after pushing a `feat/<session-id>` branch back to the remote. The same flow works against a DigitalOcean K8s cluster, not just kind.

**Monorepo properties (what the layout must support to make the milestone reachable):**
- A new contributor — assumed K8s-novice — can clone the repo, run a single bootstrap command, and reach the milestone flow locally. The plan's staged walkthrough is the on-ramp; this brainstorm just ensures the structure doesn't obstruct it.
- A change to the **HTTP/WS API contract** requires editing exactly one source file in the common case (the TypeSpec definition); regenerated TS clients and OpenAPI spec appear in the same PR; CI fails if they don't. (Substantive changes that cross the API↔CRD translation boundary are multi-file by design — see R7.)
- A change to a single service's code triggers CI jobs only for that service plus shared-package consumers — not the entire monorepo (with R14 catching false negatives nightly).
- A Go developer can reason about `services/session-operator/` in isolation without touching the TypeScript toolchain.
- Drift between the Session API surface and the CodingSession CRD surface is bounded by integration-test coverage of the fields actually exercised through the API.

## Scope Boundaries

- **No `services/deploy-controller` in v1.** Deployment is ArgoCD watching the user's app repo. Revisit only if a concrete need emerges (per-PR preview environments, custom packaging).
- **No `cli/` workspace or `openvoid` CLI in v1.** Web UI is the entry point. This is a positioning bet aligned with the hosted-first audience; defer until self-host becomes a primary audience.
- **No microVM/Firecracker runtime in v1.** v1 uses standard Pods. The pluggable-runtime interface is a controller-design concern, not a monorepo concern.
- **No multi-cluster topology decisions.** v1 assumes one cluster runs both the control plane and session pods.
- **No semver tags on services in v1.** SHA-tagged images only. Self-host operators are not the v1 audience.
- **No NPM publishing, no Changesets in v1.**
- **No Go emission from `packages/protocol` in v1.** Add when a Go consumer appears.
- **No agent-prompt/template package decisions.** Where OpenCode-specific prompts and project templates live is deferred to the controller brainstorm.
- **No automated API↔CRD schema-compatibility tooling in v1.** The Session API is the translation boundary; integration tests cover drift.
- **No detailed Helm chart structure.** `infra/helm/` will exist; chart shape is a planning concern.

## Key Decisions

- **Hosted-first audience for v1.** Drives the trunk-based release model, the no-CLI scope cut, and tolerates a niche IDL (TypeSpec) without paying an OSS-adoption tax. Self-host becomes a v1.5+ concern with explicit upgrades to release model and CLI.
- **TypeScript for `services/session-api`.** Shares contract types trivially with the Web UI; no codegen path needed for backend.
- **TypeSpec → OpenAPI 3.1 → mature codegen.** Authors edit TypeSpec; the build emits OpenAPI 3.1 as the canonical spec, then standard tools (openapi-typescript for TS) produce consumer types. This preserves TypeSpec's authoring ergonomics without betting on TypeSpec's first-party Go emitter, which is not relied upon in v1.
- **CRD types stay Go-authored, not unified with TypeSpec.** kubebuilder's Go-as-source pattern is the established K8s convention. Forcing CRDs through TypeSpec creates impedance mismatch and breaks operator tooling.
- **Session API as the explicit translation boundary.** Treats API↔CRD drift as a translation concern, bounded by integration tests, rather than as a synchronization problem requiring shared schema.
- **Single Go module in v1.** Operator lives at `services/session-operator/`. `go.work` is added when (not if) a second Go consumer appears — this is a near-zero-cost retrofit.
- **kind + Tilt for local dev.** Real K8s API for operator development. Tilt's file-sync gives sub-second iteration on TS services; the Go operator's iteration loop (rebuild + reimage + pod restart) is realistically tens of seconds — not "near `pnpm dev`," but acceptable.
- **Trunk-based for services.** Continuous delivery via ArgoCD; no semver on services in v1. Defer Changesets and any version-bump tooling until a publishable package exists.
- **Generated artifacts committed and verified.** Trade-off accepted: PRs that touch `packages/protocol/` will produce generated diffs, and concurrent PRs will collide on those generated files. Mitigation is rebase-and-regenerate; the assumption is low PR concurrency on the protocol package in v1. The benefits (honest PR diffs, no codegen toolchain required to read the repo) outweigh that cost at v1's scale.
- **CI affected-detection is verified, not trusted.** Nightly full runs catch false negatives in the affected-detection logic.
- **Image build split: `ko` for Go, `docker buildx` for TS.** Tilt uses `custom_build` for `ko`, `docker_build` for TS workspaces. Default registry is GHCR; local dev uses kind's local registry pattern.
- **Hosted-first does not mean closed-source.** The repo is OSS from day one. The "hosted-first" decision is about whom the v1 *experience* is optimized for, not about who can read or fork the code.

## Dependencies / Assumptions

- Node.js LTS (TS services run on Node; Bun permitted as a local dev runtime; CI targets Node).
- Go latest stable (`1.x`) for the operator.
- pnpm 9+ and Turborepo current major.
- kubebuilder/controller-runtime current major for the operator scaffold.
- TypeSpec compiler current; only the OpenAPI emitter is on the v1 critical path.
- `oapi-codegen` is **not** required in v1 (no Go consumer of the protocol package).
- `ko` for Go container builds; `docker buildx` for TS container builds.
- GHCR (`ghcr.io/openvoid/...`) for container registry.
- Conventional Commits enforced via commitlint or equivalent in CI.
- Bootstrap is a shell script (`./scripts/bootstrap.sh`) with no exotic tool dependencies; supports macOS (Docker Desktop or colima) and Linux (Docker or Podman).
- Workspace dependency-rule enforcement: see R4 (TS via dependency-cruiser; Go-side covered by single-module structure in v1).

## Outstanding Questions

### Resolve Before Planning

*(none — all blocking decisions resolved.)*

### Deferred to Planning

- [Affects R1, R2][Technical] Exact intra-workspace layout (e.g., `apps/web` App Router vs Pages Router; `packages/protocol` internal split).
- [Affects R9, R10][Technical] Tiltfile shape and per-image build invocation. The recommended split (`ko` for Go, `docker buildx` for TS) and registry choice (GHCR + kind local registry) are already pinned.
- [Affects R12, R13][Technical] CI workflow file structure (one workflow with jobs vs multiple workflows). Cadence is already pinned: every PR (R13) plus nightly full run (R14).
- [Affects R8][Technical] Whether the `packages/protocol/generated/` subdirectory is checked in as a flat tree or as nested per-emitter directories.
- [Affects R10][Technical] Bootstrap command implementation details (exact tool versions, idempotency, OS detection in `./scripts/bootstrap.sh`).

### Deferred to a later brainstorm

- **Agent prompts/templates location** — where OpenCode-specific system prompts, tool configs, and project-bootstrap templates live. Surfaces during the controller brainstorm.
- **Component-library catalog location** — Shadcn/Malvine library descriptors, used by the agent to scaffold UIs. Same brainstorm.
- **Per-session pod template image lifecycle** — built per commit, pinned, or pulled inside kind. Affects iteration speed and session-creation latency. Surfaces during the controller brainstorm.

### Deferred to v1.5+

- Self-host audience: semver tags on services, upgrade-notes documentation convention, CLI workspace, multi-cluster topology.
- Go emission from `packages/protocol` (when a Go consumer appears).
- `go.work` (when a second Go module appears).
- Changesets and per-package semver (when the first publishable package appears).

## Next Steps

`Resolve Before Planning` is empty.

The original ideation queued a separate session controller brainstorm (B1) before planning. Given the v1 milestone framing above (vertical slices, K8s-novice implementer, learn-by-doing), the controller's design decisions are best resolved *during* the layered build rather than upfront — slice 4 settles the CRD shape, slice 5 settles the operator's reconcile structure, slice 7 settles workspace persistence, slice 8 settles the commit-on-shutdown discipline. A standalone controller brainstorm would re-litigate decisions the staged walkthrough naturally answers.

→ Proceed directly to `/ce:plan` over this brainstorm. The plan should be a **staged walkthrough** that:

1. Starts from absolute first principles (creating a kind cluster locally, creating a DOKS cluster in DigitalOcean, basic kubectl orientation).
2. Layers the nine slices listed in **v1 Milestone & Build Strategy** above, each ending in a runnable demo.
3. Defers structural maturity (TypeSpec codegen pipeline, dependency-cruiser, nightly false-negative CI, full Helm chart structure) until the slice that demonstrably needs it — earlier slices may use simpler stand-ins.
4. Names every tool version, every command, every file path. The implementer is a Kubernetes novice; the plan is the on-ramp.

The plan may also pull select decisions back into a focused mini-brainstorm if a slice surfaces a genuine ambiguity that hasn't been resolved here.
