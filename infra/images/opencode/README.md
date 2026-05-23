# OpenCode agent image

Per-session main container for openvoid. Boots `opencode serve` (HTTP
API on `:8080`, SSE event stream on `/global/event`) and operates on a
cloned repository at `/workspace/repo`. The image is built and pushed
to the kind local registry via Tilt (`opencode-image` resource); on
DOKS, GHCR receives `ghcr.io/openvoid/opencode:<sha>` per the
cross-platform parity matrix.

## Runtime interface

| Aspect | Value |
|---|---|
| **Port** | `8080` (HTTP, OpenCode server). Pod manifests name this `agent-http` for Phase 9 routing. |
| **Health** | `GET /global/health` returns `{"healthy": true, "version": "<v>"}`. |
| **Auth** | HTTP Basic. Username `opencode` (default), password from `OPENCODE_SERVER_PASSWORD`. |
| **WORKDIR** | `/workspace/repo` — the cloned repository (mounted at runtime by the Phase 4 emptyDir + workspace-init init). |
| **PID 1** | The entrypoint shell (`opencode-entrypoint`). It backgrounds `opencode serve` and traps SIGTERM, forwarding it to the child — naïvely `exec`ing into the binary leaves OpenCode as PID 1 where Linux's PID-1 default-terminate filtering blocks SIGTERM (OpenCode does not install a handler), so the kubelet's Phase 5 SIGTERM cascade would only land on SIGKILL after the grace period. |
| **User** | UID 1000 by default; the image is also SCC-friendly (any random UID with GID 0 can write the directories the agent needs). |

## Required environment

| Variable | Required | Purpose |
|---|---|---|
| `OPENCODE_SERVER_PASSWORD` | **yes** | HTTP Basic password. Server fails to start without it. Mounted from the cluster-scoped `opencode-server-password` Secret in v1; graduates to a chart-templated auto-generated Secret in Phase 7. |

If `OPENCODE_SERVER_PASSWORD` is unset, the entrypoint exits 1 with a
clear stderr message before invoking the binary — the failure surfaces
as `Error` on the Pod rather than the binary's own stack trace.

## Mounted credentials

The image does **not** bake any LLM-provider credentials. Phase 6.2's
Session API mounts the cluster-scoped `opencode-auth` Secret as a file
on this container only:

| Path | Source | Notes |
|---|---|---|
| `/var/opencode-data/opencode/auth.json` | Secret `opencode-auth` (key `auth.json`), mounted via `subPath` | Read by OpenCode at request time. Holds OpenCode's native `auth.json` shape, e.g. `{"openrouter": {"type": "api", "key": "..."}}`. Multiple providers in a single file. |

The path is fixed via `ENV XDG_DATA_HOME=/var/opencode-data` so the
mount target is independent of the runtime UID's `$HOME` resolution
(needed for OpenShift SCC compatibility — see
`docs/spikes/2026-05-05-opencode-auth.md`).

`auth.json` is **never** mounted on `workspace-init` or `git-finalizer`.
Symmetrically, `git-creds` is **never** mounted on this container.
The mount discipline is asserted in the Session API's unit tests
(`services/session-api/test/routes.sessions.test.ts`).

If `auth.json` is **present but empty or malformed** (no usable
provider entry), the server still boots, `/global/health` returns 200,
and prompt requests fail with an upstream-auth error from the LLM
provider — the expected "agent up but cannot reach LLM" mode.

If the `opencode-auth` **Secret resource is absent from the cluster
entirely**, the kubelet blocks the pod with `CreateContainerConfigError`
before any container starts. The volumeMount is required (no
`optional: true`); graceful degradation only applies to content-level
failures, not Secret-resource absence. Both Secrets must be applied
out-of-band before creating sessions — the demo scripts at
`scripts/demos/demo-opencode-*.sh` precondition-check for them.

## Baked-in configuration

`/var/opencode-config/opencode/opencode.json` ships with the image:

- **Model**: `openrouter/anthropic/claude-sonnet-4.5` (v1 default;
  Phase 7's chart parameterizes this as `session.opencode.model`).
- **Permissions**: `bash`, `edit`, `read`, `webfetch` all `allow`.
  This is intentionally permissive in v1.1 — Phase 8 adds denylists
  (notably for `/var/opencode-data/opencode/auth.json` to prevent the
  agent from leaking its own credential via the `read` or `bash`
  tools, and `/etc/git*` to prevent indirect access to
  initContainer/sidecar volume mounts).

## Seed-on-boot

When the container starts in new-app mode (`OPENVOID_NEW_APP=true`),
the entrypoint also backgrounds `seed-agent` — a short shell script
that POSTs the user's landing-form prompt to OpenCode as the agent's
first user message, so the conversation is already in progress when
the user opens the agent UI.

**When it fires.** All three must be true:

1. `OPENVOID_NEW_APP=true` is set on the agent container (per-session
   value, controlled by `services/session-api/src/k8s/client.ts`).
2. `app/scaffold-meta.json` exists in the workspace and its `prompt`
   field is non-empty (written by `workspace-init` from the landing
   form's prompt input).
3. The sentinel file at `/workspace/.openvoid-seeded` is absent
   (idempotency across entrypoint restarts within one pod lifetime).

Import-repo pods never invoke the seed — no env, no sentinel, no
script.

**Env knobs (all optional; defaults baked into `seed-agent.sh`):**

| Variable | Default | Purpose |
|---|---|---|
| `OPENVOID_SEED_PROMPT_PATH` | `/workspace/repo/app/scaffold-meta.json` | Where the script reads the user's prompt from. |
| `OPENVOID_SEED_SENTINEL_PATH` | `/workspace/.openvoid-seeded` | Idempotency marker for this pod's lifetime. |
| `OPENVOID_SEED_OPENCODE_URL` | `http://127.0.0.1:8080` | Loopback target — never the public agent URL. |
| `OPENVOID_SEED_HEALTH_TIMEOUT_S` | `120` | How long to wait for OpenCode `/global/health` before giving up (transient — entrypoint restart will retry). |
| `OPENVOID_SEED_SESSION_TITLE` | `openvoid auto-seed` | Title used to find/create the OpenCode session for idempotency. |
| `OPENVOID_SEED_PROMPT_MAX_BYTES` | `4096` | Length bound applied to the prompt before sending. Defense-in-depth against unbounded prompt-injection payloads (see "Prompt-injection acknowledgment" below). |

Override any of these by setting the same name on the Session API
Deployment's env — `buildAgentEnv` forwards the value through to
new-app agent containers.

**Failure handling.** The script differentiates transient from
permanent failures:

- **Transient** (health timeout, network blip, HTTP 5xx, SIGTERM
  during execution): logs `[seed] giving up: ... (transient — entrypoint
  restart will retry)` and exits without writing the sentinel. The
  next time the entrypoint restarts inside the same pod (e.g., from a
  `pnpm dev` crash), the seed retries.
- **Permanent** (auth misconfig, 4xx, OpenCode API contract drift):
  logs `[seed] giving up: ... (permanent — auth misconfig or API contract
  drift)` and writes the sentinel anyway, so the pod doesn't loop
  forever on something a retry can't fix.

Double-protection against double-seeding: even if the sentinel file
is somehow cleared mid-pod-lifetime, the script first hits
`GET /session` and reuses any existing session whose title matches
`OPENVOID_SEED_SESSION_TITLE` rather than creating a new one.

**Diagnostic recipe** when "agent didn't start":

```sh
SID=<session-id>
NS=openvoid-sessions
POD=session-${SID,,}

# 1. Tail the seed's log stream — every line is [seed]-prefixed.
kubectl logs -n $NS $POD -c session --tail=200 | grep '^\[seed\]'

# 2. Check the sentinel — present means the script already ran (or
#    permanently gave up); absent means a future restart will retry.
kubectl exec -n $NS $POD -c session -- ls -la /workspace/.openvoid-seeded 2>&1

# 3. Hit OpenCode's session list from inside the pod to confirm the
#    seed call landed (look for title="openvoid auto-seed").
kubectl exec -n $NS $POD -c session -- sh -c \
  'curl -sfu "opencode:$OPENCODE_SERVER_PASSWORD" http://127.0.0.1:8080/session | head -c 500'
```

**Race with pod-Ready.** The readinessProbe gates on Vite (port
3000), not on OpenCode's `/global/health` (port 8080). If Vite warms
faster than OpenCode (uncommon but possible on warm node + cold
opencode-data), the user can click "Open agent" before the seed has
fired — they'd see an empty conversation briefly before the agent's
response streams in via OpenCode's session polling. Acceptable in v1;
a future iteration could gate the "Open agent" affordance on a
seed-complete signal if this becomes a real UX paper cut.

**Prompt-injection acknowledgment.** The user's prompt is forwarded
verbatim (modulo length bound) to OpenCode's `build`-mode agent,
which has `bash`, `edit`, `read`, and `webfetch` all set to `allow`
in the baked-in `opencode.json`. A crafted prompt CAN direct the
agent to exfiltrate workspace contents or attempt off-network calls.
The pod's network boundary contains the blast radius — the agent
only sees `/workspace` — but `webfetch: allow` does mean prompt-
injected exfiltration to an attacker-controlled HTTP endpoint is
possible. v1 accepts this risk; v1.5's Phase 8 permission denylist
+ NetworkPolicy egress allowlist are the architectural mitigations.
The `OPENVOID_SEED_PROMPT_MAX_BYTES` bound is a defense-in-depth
nudge, not a substitute for sanitization.

## Local validation

The plan's verification scenarios (Unit 6.1):

```sh
# Build (from this directory or the repo root):
docker build -t openvoid/opencode:dev infra/images/opencode/

# Happy path — health check:
docker run --rm -p 8080:8080 -e OPENCODE_SERVER_PASSWORD=dev openvoid/opencode:dev &
curl -s -u opencode:dev http://localhost:8080/global/health
# → {"healthy": true, "version": "1.14.33"}

# Error path — missing password:
docker run --rm openvoid/opencode:dev
# → [opencode] OPENCODE_SERVER_PASSWORD is required ...
# → exit 1

# UID identity (default):
docker run --rm openvoid/opencode:dev id
# → uid=1000 gid=0(root) ...

# SCC compatibility — random UID still works:
docker run --rm --user 99999999:0 openvoid/opencode:dev opencode --version
# → 1.14.33

# PID 1 / SIGTERM forwarding:
CID=$(docker run --rm -d -e OPENCODE_SERVER_PASSWORD=dev openvoid/opencode:dev)
time docker stop "$CID"
# → real time should be < 2s (proves SIGTERM reaches the binary directly)
```

## Phase relationships

- **Phase 4** provides the workspace volume (`/workspace`) and the
  `workspace-init` init container that populates `/workspace/repo`.
- **Phase 5** runs the `git-finalizer` native sidecar that, on Pod
  termination, commits and pushes the agent's edits to a
  `feat/<sessionId>` branch.
- **Phase 6.2** wires this image into the Session API's
  `buildSessionPodManifest` as the per-session main container.
- **Phase 7** moves all hard-coded constants here
  (`session.opencode.model`, the auth Secret name, etc.) into Helm
  chart values.
- **Phase 8** tightens `opencode.json` with `read`/`bash` denylists
  and adds the NetworkPolicy egress allowlist.
