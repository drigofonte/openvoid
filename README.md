# openvoid

An open-source platform for AI-assisted full-stack development. Coding sessions run as Kubernetes pods, and an AI agent (OpenCode) reads, writes, and executes code in a Git-backed workspace with a live preview.

**Status:** v1 in development. The architecture and build sequence are documented in [`docs/brainstorms/`](docs/brainstorms/) and [`docs/plans/`](docs/plans/). v1 is intentionally a learning-shaped end-to-end lifecycle proof, not a polished platform.

## What works (and what doesn't yet)

This repository is currently being built phase by phase per the v1 plan. As of today, expect:

- ✅ Planning artifacts (ideation, brainstorm, plan) committed
- 🚧 Phase 0: toolchain + repo skeleton (in progress)
- ⏳ Phases 1–9: cluster bring-up through Web UI + live preview

See the active [plan](docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md) for the full sequence.

## Bootstrap

openvoid is a polyglot monorepo with TypeScript apps and a Go Kubernetes operator. Contributors need:

### Required (every phase)

| Tool | Floor | Why | Install (macOS) | Install (Linux) |
|---|---|---|---|---|
| `docker` | running daemon | container builds and kind | [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/) or [colima](https://github.com/abiosoft/colima) | `apt install docker.io` (rootful) or rootless |
| `kubectl` | 1.30+ | talks to clusters | `brew install kubectl` | [kubectl install](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/) |
| `kind` | 0.27 | local Kubernetes-in-Docker cluster | `brew install kind` | [kind install](https://kind.sigs.k8s.io/docs/user/quick-start/) |
| `tilt` | 0.33 | local dev orchestrator | `brew install tilt-dev/tap/tilt` | [tilt install](https://docs.tilt.dev/install.html) |
| `node` | LTS (≥20) | TypeScript runtime | `brew install node@20` | `nvm install --lts` |
| `pnpm` | 9 | TS workspace package manager | `corepack enable && corepack prepare pnpm@latest --activate` | same |
| `go` | 1.22+ | Kubernetes operator language | `brew install go` | [go install](https://go.dev/doc/install) |

### Required from Phase 4 onward

| Tool | Floor | Why | Install |
|---|---|---|---|
| `kubebuilder` | 4.14 | Operator scaffolding | [kubebuilder install](https://book.kubebuilder.io/quick-start#installation) |
| `ko` | 0.16 | Go container builds (faster than Dockerfiles for Go services) | `brew install ko` or `go install github.com/google/ko@latest` |

### Required for DOKS demos (Phase 1.2 + Phase 9 onward)

| Tool | Floor | Why | Install |
|---|---|---|---|
| `doctl` | 1.110 | DigitalOcean Kubernetes CLI | `brew install doctl` |
| `cloudflared` | 2024.10 | Cloudflare Tunnel for public preview URLs | `brew install cloudflared` |
| `helm` | 3.16 | Kubernetes manifest templating | `brew install helm` |

### Recommended ergonomics

| Tool | Why | Install |
|---|---|---|
| `kubectx` + `kubens` | one-keystroke context/namespace switching | `brew install kubectx` |
| `stern` | tail logs across many pods at once | `brew install stern` |
| `k9s` | TUI dashboard for clusters | `brew install k9s` |

### Verify

After installing, run:

```bash
bash scripts/check-tools.sh
```

You should see green checkmarks for every required tool and informational notes for any optional ones missing.

## Local cluster (kind)

```bash
# Start kind + a local Docker registry on localhost:5001
bash scripts/kind-up.sh

# Tear down both
bash scripts/kind-down.sh
```

The cluster context is `kind-openvoid-local`. Re-running `kind-up.sh` is a no-op if both pieces already exist. The registry is wired into the kind network so any image pushed to `localhost:5001/...` is pullable from inside the cluster.

## Remote cluster (DigitalOcean)

```bash
# One-time per machine: authenticate doctl
doctl auth init

# Bring up (~5 min, ~$24/mo while running)
bash infra/remote/doks-create.sh

# Tear down (stops billing immediately)
bash infra/remote/doks-destroy.sh
```

Sizing, region, cost discipline, and orphaned-resource cleanup are all in [`infra/remote/README.md`](infra/remote/README.md). **Always run `doks-destroy.sh` between work sessions.**

## Context safety

openvoid uses two clusters: a local kind cluster (free, disposable) and a remote DOKS cluster (real money, demoable). It's easy to run a destructive command in the wrong place. Three rules:

1. **Check before destructive commands.**
   ```bash
   bash scripts/kctx-check.sh && kubectl delete codingsession my-session
   ```
   The check prints the current context with color coding — green for local kind, yellow for remote DOKS, red for unknown. If it's not what you expect, stop and switch.

2. **Use [`kubectx`](https://github.com/ahmetb/kubectx) for one-keystroke switching.** Install via `brew install kubectx`. Then:
   ```bash
   kubectx kind-openvoid-local       # back to local
   kubectx do-nyc1-openvoid-dev      # switch to DOKS
   kubectx -                         # toggle back
   ```

3. **Show the context in your shell prompt.** Either [`kube-ps1`](https://github.com/jonmosco/kube-ps1) (bash/zsh) or [Starship](https://starship.rs/) with the `kubernetes` module enabled. The cost of seeing the context permanently is one line of shell-rc config; the cost of *not* seeing it is a `kubectl delete -A` against production.

Pin a default namespace per context to avoid `-n` typos:

```bash
kubectl config set-context --current --namespace=openvoid-system
```

## Repo layout

```
apps/                # User-facing applications (Next.js Web UI lands here)
services/            # Backend services (Session API in TS, Session Operator in Go)
packages/            # Shared TypeScript packages (TypeSpec contracts, etc.)
infra/               # Helm charts, ArgoCD manifests, CRD YAML, kind/DOKS scripts
scripts/             # Repo-wide utility scripts
docs/                # Ideation, brainstorm, plan, and post-phase demo notes
```

The structure follows the [monorepo brainstorm](docs/brainstorms/2026-05-01-monorepo-layout-requirements.md). Workspace dependency rules: `apps/*` and `services/*` may depend on `packages/*`; `packages/*` cannot depend on the others; no cross-service code imports.

## How v1 is built

The [plan](docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md) layers nine vertical slices, each ending in a runnable, demoable artifact:

0. Toolchain + repo skeleton + OpenCode endpoint spike
1. Cluster bring-up (kind locally + DOKS remotely)
2. Hello-world pod (port-forward + curl)
3. Session API skeleton (creates Pods, OpenAPI-driven)
4. CodingSession CRD (schema only)
5. Session Operator + Helm chart skeleton + NetworkPolicy + ArgoCD wiring
6. Real OpenCode image (with tightened permissions)
7. Workspace + Git (PVC, agent reads/writes/executes)
8. Commit-on-shutdown (push `feat/<sessionId>` before terminate)
9. Web UI (NextAuth + GitHub OAuth) + live preview

Each phase has explicit demoable checkpoints. Read the plan before starting any phase.

## License

[MIT](LICENSE).
