---
date: 2026-05-05
topic: opencode-llm-provider-auth
status: complete
plan-unit: docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md (Unit 6.0)
opencode-version-tested: 1.14.33
---

# OpenCode LLM Provider Auth Spike

## Why this spike exists

Phase 6.2 needs to mount LLM-provider credentials onto the OpenCode main container. The plan flagged two unknowns before any pod-manifest code is written:

1. **Where does OpenCode read credentials at runtime** — file path, env var, or both?
2. **Does OpenRouter need any special wire shape** (e.g., explicit `baseURL` / `compatible: openai`), or is it a first-class provider OpenCode handles natively?

Answering these decides whether Unit 6.2 mounts a Secret as a file (`auth.json`) or projects it as env vars — and what shape the chart values take in Phase 7.

## What was tested

- `npm install opencode-ai@1.14.33` in an isolated sandbox (`/tmp/opencode-spike`); the binary is `node_modules/.bin/opencode` (resolves to `node_modules/opencode-darwin-arm64/bin/opencode` on this host).
- Five clean-HOME test scenarios with `env -i` to control credential sources:
  1. Empty `HOME`, no env vars → confirm "no credentials" baseline.
  2. Empty `HOME`, all three env vars set (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` with dummy values) → confirm env-var detection.
  3. Hand-written `auth.json`, no env vars → confirm file shape OpenCode parses.
  4. Hand-written `auth.json` with a real OpenRouter key, default model → confirm full request reaches OpenRouter (auth wire works).
  5. Hand-written `auth.json` + `opencode.json` declaring `"model": "openrouter/anthropic/claude-sonnet-4.5"` → confirm config-driven model selection.
- Probed `GET /provider`, `GET /config`, `POST /session`, `POST /session/:id/message` with HTTP Basic auth (`opencode:spike`).

## Findings

### Auth file path — XDG_DATA_HOME-rooted

```
$XDG_DATA_HOME/opencode/auth.json
default: $HOME/.local/share/opencode/auth.json
```

Confirmed by setting `XDG_DATA_HOME` and `HOME` independently. The path is XDG-compliant on Linux/macOS. **The container's `auth.json` mount path is deterministic** if `XDG_DATA_HOME` is set explicitly in the image. Unit 6.1 will pin `XDG_DATA_HOME=/var/opencode-data` in the Dockerfile (see "Decision" below for rationale), so Unit 6.2 mounts the Secret at `/var/opencode-data/opencode/auth.json` regardless of the runtime UID.

The config file (`opencode.json`) is searched at:

```
$XDG_CONFIG_HOME/opencode/{config.json, opencode.json, opencode.jsonc}
default: $HOME/.config/opencode/opencode.json
```

Unit 6.1 similarly pins `XDG_CONFIG_HOME=/var/opencode-config`, so the baked-in `opencode.json` lives at `/var/opencode-config/opencode/opencode.json`. Two distinct directories — config and auth are mounted/baked independently.

### Auth-file shape

```json
{
  "anthropic":  { "type": "api", "key": "<key>" },
  "openai":     { "type": "api", "key": "<key>" },
  "openrouter": { "type": "api", "key": "<key>" }
}
```

The top-level keys are provider IDs; each value is an object with `type` and `key`. Multiple providers can co-exist in a single file. `opencode auth list` reports them as `Credentials` (`api` type). The shape matches what `opencode auth login` writes interactively.

### Env-var fallback works for all three providers

With no `auth.json` present and `ANTHROPIC_API_KEY=…`, `OPENAI_API_KEY=…`, `OPENROUTER_API_KEY=…` exported, `opencode auth list` reports them under `Environment`. Each provider's expected env-var name is declared in `GET /provider`'s response (`env: ["OPENROUTER_API_KEY"]` for openrouter, etc.).

End-to-end test (clean `HOME`, env-only, real OpenRouter key) — the request reached OpenRouter and returned a real upstream error (the default-selected model was unavailable on the account), proving the key was forwarded by OpenCode to the upstream API. Auth wire confirmed.

### File-mount path: end-to-end verified

Hand-written `auth.json` containing a real OpenRouter key, plus `opencode.json` declaring `model: "openrouter/anthropic/claude-sonnet-4.5"`, yielded:

```
modelID:    anthropic/claude-sonnet-4.5
providerID: openrouter
error:      none
text:       PHASE6OK
```

The full request → response cycle succeeded with file-only auth. No env vars needed.

### OpenRouter is a first-class provider

OpenRouter does **not** require explicit `baseURL` or `compatible: openai` declarations. OpenCode treats it as a native provider with its own ID (`openrouter`). The model-id format is `<upstream-provider>/<model>` — e.g., `openrouter/anthropic/claude-sonnet-4.5` (in `opencode.json`'s `model` field, which expects the full `provider/model` shape; for OpenRouter models, `model` becomes `<upstream>/<id>` because OpenRouter itself routes to upstreams).

Confirmed working model strings on the test account:
- `openrouter/anthropic/claude-sonnet-4.5` ✓ (tested, returned response)
- `openrouter/google/gemini-3-pro-preview` ✗ (404 — no endpoints found for this model on the account)

The default model (when `opencode.json` is absent) is OpenCode's hard-coded fallback (`google/gemini-3-pro-preview` for the openrouter provider), which is **account-availability-dependent** — Unit 6.1 should explicitly set `model` in `opencode.json` rather than relying on the default.

### Precedence when both file and env are set

Not load-bearing for v1 — we will pick exactly one delivery mechanism. (Anecdotally, `auth list` reports both sources separately; from the SDK pattern, file-loaded credentials passed as constructor options typically beat env vars at request time, but this was not stress-tested because v1 will not configure both.)

### Other observations relevant to Phase 6

- `opencode serve` on Linux respects `--hostname 0.0.0.0` and `--port 8080`; default hostname is `127.0.0.1` (must be overridden in the container so kube-proxy can reach the pod).
- `OPENCODE_SERVER_PASSWORD` is required at server start — process exits if unset. Phase 6.2 wires this via `valueFrom.secretKeyRef`.
- `opencode auth list` and `opencode serve` both perform a one-time SQLite migration on first boot in a fresh `XDG_DATA_HOME`. Image init is ~3-4 s on Apple Silicon (acceptable for v1; pod readiness can simply wait for `/global/health` to return 200).

## Decision: file mount via `auth.json` Secret, fixed absolute path

**Selected path: file mount, with `XDG_DATA_HOME` and `XDG_CONFIG_HOME` pinned to absolute paths in the image.** Phase 6.1 builds an OpenCode image that sets `ENV XDG_DATA_HOME=/var/opencode-data` and `ENV XDG_CONFIG_HOME=/var/opencode-config`. Phase 6.2 projects the cluster-scoped `opencode-auth` Secret as a volume on the agent main container, mounted at `/var/opencode-data/opencode/auth.json` with `subPath: auth.json`.

### Why fixed absolute paths instead of `$HOME`-relative

OpenCode resolves `auth.json` via `$XDG_DATA_HOME/opencode/`, falling back to `$HOME/.local/share/opencode/`. If we relied on `$HOME` resolution, the v1.5 OpenShift transition would break: SCC `restricted-v2` randomizes the runtime UID, and that UID typically has no `/etc/passwd` entry, so `$HOME` resolves to `/` and OpenCode looks at `/.local/share/opencode/auth.json` — a path the mount manifest never wrote to. Pinning `XDG_DATA_HOME` to an absolute path:

- Makes v1.5 OpenShift readiness a no-op (the mount target is the same regardless of UID).
- Lets Phase 8's `opencode.json` denylist reference one canonical absolute path (not a `$HOME`-relative variant).
- Removes one runtime resolution surprise across kind / DOKS / OpenShift parity.

The `/var/opencode-data` directory is created in the Dockerfile with `chgrp 0 + chmod g=u` (matching the SCC pattern the plan already applies to `/opt/opencode` and `/workspace`), so any UID with GID 0 can write the SQLite migration files OpenCode produces on first boot.

### Why file, not env vars

- **Native UX parity.** `auth.json` is what `opencode auth login` writes. Operators can hand-author it from the OpenCode docs without learning openvoid-specific env-var names.
- **Multi-provider in one Secret.** A single `data.auth.json` field can hold any combination of `anthropic` / `openai` / `openrouter` (or future providers). Env-var projection requires one `secretKeyRef` per provider per pod, which churns the manifest every time the platform operator adds or removes a provider.
- **Threat-model symmetry with `git-creds`.** Phase 4's pattern is "one Secret, one volumeMount, one container." `auth.json` mirrors that exactly. Env-var projection diffuses the credential into multiple env entries, which is harder to audit (`kubectl describe pod` lists every env reference).
- **No real downside.** Both mechanisms work end-to-end. File mount is one extra volumeMount line in the manifest — a trivial cost compared to the auditability and operator-UX wins.

### Knock-on consequences for Phase 6.1 and 6.2

1. **Phase 6.1 Dockerfile** — sets `ENV XDG_DATA_HOME=/var/opencode-data` and `ENV XDG_CONFIG_HOME=/var/opencode-config`. Both directories are created with `chgrp 0 + chmod g=u` so the SQLite migration files OpenCode writes on first boot succeed under any SCC-assigned UID. The `opencode.json` config file is baked into the image at `/var/opencode-config/opencode/opencode.json` (it ships with the image — no runtime mount needed).
2. **Phase 6.1 `opencode.json`** — must declare the model explicitly (`"model": "openrouter/anthropic/claude-sonnet-4.5"` for the v1 default), because OpenCode's default-model fallback resolves to a model that is not available on every OpenRouter account.
3. **Phase 6.1 entrypoint.sh** — does **not** need to source any env vars or copy files into place. It only `exec`s `opencode serve --host 0.0.0.0 --port 8080`. The file mount and config files are already in place by the time the entrypoint runs.
4. **Phase 6.2 `client.ts`** — main container gets:
   - `volumeMounts`: `{ name: "opencode-auth", mountPath: "/var/opencode-data/opencode/auth.json", subPath: "auth.json", readOnly: true }`.
   - `volumes`: `{ name: "opencode-auth", secret: { secretName: "opencode-auth", items: [{ key: "auth.json", path: "auth.json" }], defaultMode: 0o400 } }`.
   - **Not** mounted on `git-clone` or `git-finalizer` (mount-discipline assertion in unit tests).
5. **Phase 6.2 example manifest** (`infra/local/opencode-auth-secret.yaml.example`) — shape:
   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: opencode-auth
     namespace: openvoid-system
   type: Opaque
   stringData:
     auth.json: |
       {
         "openrouter": { "type": "api", "key": "REPLACE_WITH_OPENROUTER_KEY" }
       }
   ```
   Operators populate only the provider(s) they intend to use.
6. **Phase 7 chart values shape** (forward note for Phase 7's planning):
   - `session.opencode.provider: openrouter` (default).
   - `session.opencode.model: anthropic/claude-sonnet-4.5` (default; the chart concatenates `<provider>/<model>` for `opencode.json`'s `model` field).
   - `session.opencode.authSecret: opencode-auth` (Secret name; stays externally managed because real LLM keys cannot be auto-generated).

## Leak surface and what handles each layer

The file-mount approach is durable across Phases 6 → 8 → 9 and v1.5 OpenShift, but it is not self-contained as a security story. Phase 6 establishes the credential's *delivery* and *isolation* discipline; Phases 7–8 add the surrounding hardening. The table makes the seams explicit so nothing falls between phases.

| Vector | Handled in | Mechanism |
|---|---|---|
| Cross-container exposure (`git-clone`, `git-finalizer` reading the LLM key) | **Phase 6.2** | Mount-discipline unit tests assert `opencode-auth` volumeMount appears only on the agent main container. |
| Agent process reaches K8s API to enumerate Secrets | **Phase 6.2** | `automountServiceAccountToken: false` on session pods. |
| Agent reads its own `auth.json` via `read` tool and emits it on the SSE stream | **Phase 8** | `opencode.json` `permission.read` denylist for `/var/opencode-data/opencode/auth.json` and the parent dir. |
| Agent reads `auth.json` via `bash` tool (`cat`, `od`, `dd`, etc.) | **Phase 8** | `opencode.json` `permission.bash` denylist for the same path. Bypassable in principle, but raises cost. |
| Agent commits the key into `/workspace`, finalizer pushes it to GitHub | **Phase 8** | Same read/bash denials prevent the agent from sourcing the key in the first place. |
| Agent exfiltrates a leaked key to an arbitrary host | **Phase 8** | NetworkPolicy egress allowlist (`session.allowedLLMHosts`) restricts session-pod egress to LLM provider hostnames only. |
| Operator commits `opencode-auth-secret.yaml` (real values) to git | **Phase 6.2** | `.gitignore` excludes `infra/local/opencode-auth-secret.yaml`; `.example` ships with placeholder. |
| Image leak (key baked into the image) | **Phase 6.1** | `auth.json` is not in the image — runtime mount only. |
| OpenCode logs the key | **Phase 6.1 verification** | Spike confirmed no auth/credential resolution in `--log-level DEBUG` startup logs; re-verify in Unit 6.1 with a real key. |
| etcd at rest | **Out of scope for v1; v1.5 deployment requirement** | DOKS encrypts etcd by default; document this for v1.5. |
| Per-user key isolation (BYOK) | **Post-v1.5** | Per-session Secret created by Session API at `POST /sessions`, owned by the Pod via `ownerReferences`. Mount mechanism unchanged. |

Phase 8's `opencode.json` denylist is the single most important hardening that this spike's decision implies but does not itself implement — without it, a prompt injection from a cloned repo's README is sufficient to leak the LLM key on the SSE stream. Phase 8 already exists in the plan as the "safety rails" phase; this spike re-confirms its scope.

## Open follow-ups (not blocking Phase 6)

- **OpenCode upgrade path.** The auth-file shape is stable in 1.14.x; verify before bumping to a future major. The `opencode.json` schema is published at `https://opencode.ai/config.json`.
- **Multi-provider failover.** OpenRouter handles upstream failover internally (one of the reasons the plan recommends it as the v1 default). If the platform operator wants OpenCode-side failover across native providers (e.g., Anthropic primary, OpenAI fallback), that's a Phase 8+ concern — `opencode.json` supports a `model` array but the behavior wasn't stress-tested in this spike.
- **Secret rotation.** Updating the `opencode-auth` Secret does not automatically restart running session pods. v1 accepts this — sessions are short-lived (max 4 h via `activeDeadlineSeconds`); a rotated key applies to all new sessions immediately. Phase 8+ may add a controller-driven roll if needed.
- **OpenRouter base URL override.** Not needed for v1 (OpenCode handles routing natively), but if openvoid ever wants to point OpenRouter at a private gateway / proxy, OpenCode supports `baseURL` per-provider in `opencode.json` (untested in this spike).
