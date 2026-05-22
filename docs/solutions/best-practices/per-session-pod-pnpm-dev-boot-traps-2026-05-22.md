---
title: Five boot-time traps when adding pnpm install + dev server to per-session K8s pods
date: 2026-05-22
category: best-practices
module: infra/images
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "Evolving an init container's role from `git clone` to `git clone + pnpm install`"
  - "Adding `pnpm dev` as a sibling process to an existing main container's primary binary"
  - "Wiring a Kubernetes readinessProbe against a dev-server port that the agent or operator pre-starts"
  - "Pinning Dockerfile-baked tool versions against versions a scaffold's package.json declares"
related_components:
  - development_workflow
  - authentication
tags:
  - kubernetes
  - init-containers
  - pnpm
  - corepack
  - vite
  - readiness-probe
  - resource-limits
  - oom
  - pat-leak
  - dockerfile
---

# Five boot-time traps when adding pnpm install + dev server to per-session K8s pods

## Context

openvoid's per-session pods evolved through two roles. **v0** (Phase 4): an init container that did one thing — `git clone` the user's repo into an `emptyDir` volume — followed by a main container running just `opencode serve`. **v1** (this PR): the init container also seeds a scaffold and runs `pnpm install --frozen-lockfile`, and the main container runs `pnpm dev` as a sibling to `opencode serve` under a single bash entrypoint with a Kubernetes `readinessProbe` against port 3000.

Every layer that "just bumped one thing" surfaced an assumption baked in for the simpler v0 shape. The end-to-end smoke that brought the new-app flow up cycled through five separate failure modes before reaching Ready=True. Each cost real minutes to hours of debug time, often with opaque error messages. This doc captures all five as a checklist — when you next evolve a per-session pod's role, walk it.

## Guidance

When extending an init or main container to do meaningfully more work than before, audit these five surfaces before declaring the work done. Each maps to a real trap surfaced in this PR.

### 1. Init container resource budget — sized for the OLD role

**Symptom.** Init container exits with code 137, pod shows `Init:OOMKilled` in `kubectl describe`. Logs may show `pnpm install` mid-execution then cut off.

**Cause.** The init container's `resources.limits.memory` was sized for its old, lighter role (e.g., `git clone` alone fits in 128 MiB). Adding `pnpm install` peaks around 600–700 MB during the resolver + node_modules extraction step, blowing past the old limit.

**Fix.** Split the init resource budget per-container rather than sharing one constant across the workspace-init + git-finalizer init containers. workspace-init needs 1 GiB; git-finalizer stays at 128 MiB. Crucially, pod-level scheduling takes `max(initContainer limits, sum(containers))` — bumping one init container's limit doesn't change the pod's effective scheduling footprint as long as a main container already sits at the same or higher limit.

```ts
// Before — one shared constant
export const SESSION_INIT_MEMORY_LIMIT = "128Mi";

// After — per-container
export const SESSION_WORKSPACE_INIT_MEMORY_LIMIT = "1Gi";   // pnpm install peak
export const SESSION_FINALIZER_MEMORY_LIMIT = "128Mi";       // idle + one push
```

**Diagnostic.** `kubectl get pod <name> -o jsonpath='{.status.initContainerStatuses[*].state}'` — `terminated.exitCode: 137 reason: OOMKilled` is unambiguous.

### 2. Image base Node version vs scaffold's `engines.node`

**Symptom.** `pnpm install --frozen-lockfile` exits with `ERR_PNPM_UNSUPPORTED_ENGINE`, message like `Expected version: ^22 \|\| >=24`, `Got: v20.20.2`.

**Cause.** The Dockerfile's `FROM node:20-alpine` predates the scaffold's `package.json` `engines.node: "^22 \|\| >=24"` field (which is what `pnpm create vite` + React Router v7 generates today). pnpm honours `engines.node` strictly under `--frozen-lockfile`.

**Fix.** Bump the Dockerfile base to a Node version the scaffold's `engines.node` accepts. For openvoid this meant `FROM node:20-alpine` → `FROM node:22-alpine` on both the workspace-init and opencode images (in lockstep — the main container also runs the same scaffold's `pnpm dev`).

**Diagnostic.** `kubectl logs <pod> -c workspace-init` shows the engines-mismatch error verbatim; cross-check with `kubectl exec <pod> -c workspace-init -- node --version`.

### 3. Per-session corepack download tax

**Symptom.** `kubectl logs <pod> -c workspace-init` shows `! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-X.Y.Z.tgz` on every session boot. Adds multi-second startup latency and a registry round trip per session.

**Cause.** The Dockerfile pins a loose pnpm version (`corepack prepare pnpm@10`), but the scaffold's `package.json` `packageManager` field pins an exact patch (`pnpm@10.33.0`). Corepack respects the scaffold's pin, sees it doesn't match the cached version, and downloads the exact patch at runtime.

**Fix.** Pin the Dockerfile's pnpm version to **exactly** what the scaffold's `packageManager` field declares. When the scaffold's lockfile is regenerated and the pin bumps, update the Dockerfile in lockstep.

```dockerfile
# Before — corepack downloads the scaffold's pinned patch every session
&& corepack prepare pnpm@10 --activate

# After — cached binary is used, no per-session download
&& corepack prepare pnpm@10.33.0 --activate
```

**Diagnostic.** Search for `Corepack is about to download` in the agent or init container logs; presence is the symptom.

### 4. PAT leak to container stdout via `git push -u`

**Symptom.** `kubectl logs <pod> -c workspace-init` includes a line like `branch 'main' set up to track 'https://x-access-token:github_pat_11AALYZ2Q0…@github.com/<org>/<repo>.git/main'`. The full PAT lands in the log stream and any downstream log aggregator.

**Cause.** Token-injection for an HTTPS push (`auth_url="https://x-access-token:${GIT_TOKEN}@${host_and_path}"`) is the standard pattern. `git push -u <auth_url> main` triggers git's auto-printed `branch '<branch>' set up to track '<upstream>'` line — which expands `<upstream>` to the full auth_url including the token.

**Fix.** Drop the `-u` flag from the seed push. The token only ever lives in the in-memory `$auth_url` variable; the persisted remote (`git remote add origin "$REPO_URL"`) stays clean. Upstream tracking isn't needed when the push is one-shot and downstream pushes derive their own auth from `REPO_URL` + `GIT_TOKEN`.

```sh
# Before — git auto-prints the auth_url to stdout
git push -u "$auth_url" main

# After — no upstream tracking, no auto-print, no leak
git push "$auth_url" main
```

**Diagnostic.** `kubectl logs <pod> -c workspace-init | grep -E 'x-access-token|github_pat_'` — any match is a leak. Rotate the PAT and apply the fix.

### 5. Vite default port (5173) vs readinessProbe target (3000)

**Symptom.** Pod stays `1/2 Running` indefinitely. `kubectl describe pod` shows `Readiness probe failed: Get "http://<pod-ip>:3000/": dial tcp <ip>:3000: connect: connection refused` recurring. The session UI gets stuck on "Booting agent" forever.

**Cause.** Vite's default dev-server port is 5173, not 3000. A scaffold generated by `pnpm create vite` without an explicit `server.port` in `vite.config.ts` binds to 5173 — invisible to a Kubernetes `readinessProbe` configured for port 3000. Probe failures don't restart the container (readinessProbe only flips `Ready=false`), so the pod sits in a permanent stuck state.

**Fix.** Either change the probe target (and Service port + Ingress backend) or — preferably — fix the scaffold to bind to the agreed port. The scaffold spec is the right place to enforce this:

```ts
// vite.config.ts in the scaffold repo
import { reactRouter } from "@react-router/dev/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [reactRouter()],
  server: {
    host: "0.0.0.0",     // pod-reachable (loopback isn't on the pod network)
    port: 3000,          // matches the readinessProbe + Service + Ingress
    allowedHosts: true,  // accepts the per-session Host header
  },
})
```

All three `server.*` keys are load-bearing inside Kubernetes. `host: "0.0.0.0"` so kube-proxy can reach Vite; `port: 3000` to match the probe and ingress; `allowedHosts: true` so Vite 5+ doesn't 403 the nip.io / preview-ingress Host header.

**Diagnostic.** Inside the pod:

```sh
kubectl exec <pod> -c session -- sh -c 'ss -tnlp 2>/dev/null || netstat -tnlp 2>/dev/null' | grep LISTEN
```

If the LISTEN line shows `0.0.0.0:5173` instead of `0.0.0.0:3000`, the scaffold's `vite.config.ts` is missing `port: 3000`.

## Why This Matters

Each of the five traps has the same shape: an assumption baked into v0 that doesn't survive the v1 evolution. None of them produce a useful error message:

- OOMKill shows up as `exit 137` (kernel-level signal, no log tail).
- pnpm's engine error names the wrong fix to the unwary (the message says "install the required Node version" — but the actual fix is to bump the *image base*, not the user's machine).
- The corepack download tax is silent — it just adds latency every session.
- The PAT leak is silent — `git push -u` looks normal; the security cost surfaces only when someone audits logs.
- The Vite port mismatch produces an infinite "stuck on Booting agent" with no failed-deployment event.

All five compound when you're new to the codebase or the stack. Together they represent ~3 hours of end-to-end smoke debugging in this PR, all avoidable.

The cheapest moment to catch these is the first time you make a Dockerfile bump, an init-container role change, or a probe target choice. This checklist is the artifact that turns the next 3 hours into 5 minutes.

## When to Apply

- **Before merging** any PR that adds `pnpm install` or `npm install` to an init container that previously did only lightweight work.
- **Before merging** any PR that adds a dev server as a sibling process in a container whose main binary historically ran alone.
- **Before merging** any scaffold change that touches `package.json` `engines.node` or `packageManager`.
- **Before merging** any change to a Kubernetes readinessProbe's target port — verify the actual process the probe targets is bound to that port (`ss -tnlp` from inside the pod).
- **When debugging** `Init:OOMKilled`, `ERR_PNPM_UNSUPPORTED_ENGINE`, "Booting agent" stuck states, or any 403 around git push operations — walk this checklist in order.

## Examples

Reference commits from the PR that surfaced these traps (`feat: coding-session scaffold bootstrap (new-app entry)`, merged in `f5a13f1`):

- `4e4c52e` — Trap 1 fix: split init-container resource budget (workspace-init → 1 GiB).
- `3b527fb` — Traps 2 + 4 fix: Node 20 → 22 + pnpm 9 → 10 across both images; drop `-u` from the seed push.
- `be2ec0b` — Trap 3 fix: pin pnpm to exact patch version (`pnpm@10.33.0`) to skip per-session corepack download.
- Trap 5 fix lives in the external `<platform-org>/scaffold-react-rr7` repo's `vite.config.ts`, not in this monorepo.

## Related

- [`docs/scaffolds/react-rr7-minimum.md`](../../scaffolds/react-rr7-minimum.md) — scaffold spec; the `vite.config.ts` shape that avoids Trap 5 is documented there.
- [`infra/images/workspace-init/Dockerfile`](../../../infra/images/workspace-init/Dockerfile) and [`infra/images/opencode/Dockerfile`](../../../infra/images/opencode/Dockerfile) — both carry inline comments explaining the Node 22 + pnpm 10.33.0 pins (Traps 2 + 3).
- [`infra/images/workspace-init/init.sh`](../../../infra/images/workspace-init/init.sh) — the `run_new_app()` function explains the `git push` (no `-u`) discipline (Trap 4).
- [`services/session-api/src/k8s/client.ts`](../../../services/session-api/src/k8s/client.ts) — `SESSION_WORKSPACE_INIT_*` vs `SESSION_FINALIZER_*` constants encode the per-container budget split (Trap 1).
- Sibling learning: [`docs/solutions/documentation-gaps/github-pat-createinorg-administration-permissions-2026-05-22.md`](../documentation-gaps/github-pat-createinorg-administration-permissions-2026-05-22.md) — separate GitHub PAT scoping trap from the same PR's end-to-end smoke.
