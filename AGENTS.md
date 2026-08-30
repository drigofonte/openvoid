# AGENTS.md

openvoid is a greenfield "describe an app, get a running sandbox" platform — Replit / v0 / Lovable adjacent. Per-session Kubernetes pods run an OpenCode agent + a user dev server; landing (Remix 3) drives the lifecycle through a small Session API (Hono + TypeSpec).

This file is the orientation a fresh agent (Claude, another model, or a human walking in cold) needs to be useful here. It is intentionally short — depth lives in the linked docs.

## Documentation map

Most non-obvious decisions and lessons live in `docs/`. Read or grep before reinventing.

- `docs/plans/` — planning artifacts, one per feature, frontmatter-indexed. The latest plan for an area is usually the authoritative source of intent.
- `docs/brainstorms/` — requirements docs (`ce-brainstorm` output) that feed `docs/plans/`.
- `docs/solutions/` — documented solutions to past problems (bugs, best practices, workflow patterns, documentation gaps), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`, `component`, `severity`). Relevant when implementing or debugging in documented areas — grep for symptoms, error messages, module names, or component types before assuming a problem is new.
- `docs/runbooks/` — operator-facing setup and rotation procedures (one-time work that's hard to derive from code).
- `docs/scaffolds/` — specs for external scaffold-template repos that aren't checked into this monorepo but are part of the platform's contract.
- `docs/spikes/` — investigation write-ups from before a decision was made.
- `docs/research/` — external research compiled for planning input.
- `docs/designs/` — UI design references (Hi-Fi HTML mockups).

## Tenancy

openvoid is a **many-users / one-platform-owned-source-control-account** product. The platform owns the org-level GitHub access and creates per-app repos under it on the user's behalf. **Never** provision per-user git credentials — that path is intentionally not taken and will surprise readers if introduced. See `docs/runbooks/platform-github-org-setup.md` for the operator setup and `docs/solutions/documentation-gaps/github-pat-createinorg-administration-permissions-2026-05-22.md` for the non-obvious PAT scope requirement.

## Stack

- **Monorepo**: pnpm workspace + turbo, TypeScript everywhere except shell glue.
- **Protocol**: `packages/protocol/` — TypeSpec source, generates OpenAPI 3.1 + TS types into `generated/`. Run `pnpm --filter @openvoid/protocol generate` after editing `main.tsp`.
- **Session API**: `services/session-api/` — Hono server, drives K8s via `@kubernetes/client-node`. Tests via vitest.
- **Landing**: `services/landing/` — Remix 3 (SSR-first; `clientEntry` for the few interactive surfaces). Tests via `remix/test`. The May-2026 redesign replaced the Phase-7 throwaway — apply normal quality bar.
- **Per-session pods**: three container images under `infra/images/` — `workspace-init` (initContainer; clones scaffold/repo + runs `pnpm install`), `opencode` (main container; agent + optional `pnpm dev`), `git-finalizer` (native sidecar; pushes on SIGTERM).
- **App databases**: external. Apps get a MongoDB-compatible database from
  [drigodb](https://github.com/drigolabs/drigodb), a separate Drigolabs service that openvoid calls
  over HTTP. It is not part of this repo and not deployed by it. See
  `docs/architecture/app-data-service-boundary.md` for the boundary, and the superseded note at the top
  of `docs/plans/2026-08-29-001-...` for what openvoid still has to build against it.
- **Local cluster**: kind (`openvoid-local-control-plane`) + Tilt. `tilt up` from repo root. The local
  cluster now runs Calico rather than kindnet, because kindnet silently ignores NetworkPolicy —
  `scripts/check-netpol.sh` proves enforcement.
- **Remote cluster**: DigitalOcean Kubernetes (DOKS) — env-overridable routing constants in `services/session-api/src/k8s/client.ts`.

## Conventions

- **Plans-first for non-trivial features.** Use `ce-brainstorm` → `ce-plan` → `ce-work`. The plan is a decision artifact, not an execution script — preserved across implementation.
- **Conventional commit titles** (`type(scope): description`), imperative, under ~72 chars. Match the patterns in `git log --oneline -20` if unsure.
- **No comments unless the WHY is non-obvious.** Don't narrate WHAT the code does. Don't reference the current task ("added for X", "used by Y"); those rot.
- **Reference files inline as `path:line`** (e.g. `services/session-api/src/k8s/client.ts:60`) so the reader can jump straight there.
- **Test before declaring done.** Run the package's tests (`pnpm --filter @openvoid/<pkg> test`) and typecheck after any code change.
- **When debugging surface symptoms cross-cut multiple traps**, walk the relevant checklist in `docs/solutions/best-practices/` first before bisecting.

## Compound Engineering

`docs/solutions/` is populated by `/ce-compound` after a non-trivial fix or learning. The greppable frontmatter is the point — every entry should be findable by error message, module name, or component without prior knowledge of its existence. Refresh stale entries with `/ce-compound-refresh <scope>` when a related change lands.
