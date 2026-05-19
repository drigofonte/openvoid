---
title: "Platform GitHub org setup"
type: runbook
audience: operator
date: 2026-05-19
---

# Platform GitHub org setup

One-time setup for the platform-owned GitHub organization that hosts
every per-app repo created via the "new app" entry point on landing.
This is operator setup, not user setup — users never see this token and
never authenticate against GitHub themselves.

This runbook is the only authoritative source for the org name, PAT
scopes, and Secret-manifest contents required to wire up
`POST /sessions { mode: "new-app" }`. If you are debugging "I created
the Secret but the Session API still 401s at boot", you are in the
right document.

## Why

The v1 tenancy model is: one platform-owned source-control account,
many users (see [docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md](../plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md)
Key Technical Decisions → "Tenancy & repo-ownership model"). Every app
a user starts becomes a repo under the platform org. The Session API
needs a Personal Access Token under that org with permission to create
new repos and push to them; that token is the `github-platform-creds`
Secret.

This is distinct from the existing `git-creds` Secret — that one
authenticates the import-repo path against a single test repo, and is
scoped accordingly. The platform-creds token can do more (create repos
under the whole org) and is therefore mounted only on the containers
that need it.

## Prerequisites

- A GitHub account you control that can either create a new org or is
  already an owner of the intended platform org.
- `kubectl` configured against the cluster you are wiring up (kind
  locally; the DOKS context on a remote install).
- The repo cloned locally so you can edit `infra/local/session-api.yaml`
  if your org name differs from `openvoid-platform`.

## Step 1 — Provision the org (one-time)

1. Sign in to GitHub.
2. Visit https://github.com/account/organizations/new and create a free
   org. Recommended name: `openvoid-platform` (matches the default in
   `infra/local/session-api.yaml`'s `OPENVOID_PLATFORM_GITHUB_ORG`
   env). If your preferred name is taken, pick another — you will
   override the env in step 4.
3. Skip the "invite members" step. The platform org has exactly one
   real owner; nobody else needs access.
4. Org → Settings → Member privileges → set "Base permissions" to
   `None`. Repos this org creates will be public-by-default at first,
   but you do not want any future invited member to inherit read on
   user repos.

## Step 2 — Create the fine-grained PAT

Fine-grained PATs scope down to a single org and a defined permission
set. Coarse "classic" PATs grant access to every repo your account can
see — do not use one.

1. Visit https://github.com/settings/personal-access-tokens/new.
2. **Token name**: `openvoid-platform — Session API (DATE)` — include
   the date so rotation telemetry has a paper trail.
3. **Expiration**: pick the longest your security policy allows. The
   PAT is the load-bearing credential for the new-app flow; expiry
   takes the platform down until the operator regenerates and reapplies.
4. **Resource owner**: select the platform org from step 1 (NOT your
   personal account).
5. **Repository access**: "All repositories". The PAT must be able to
   write to repos that do not exist yet at token-creation time (every
   per-app repo is created on demand by the Session API).
6. **Organization permissions** — set `Administration` to
   `Read and write`. **This is the easy one to miss.** It lives under
   "Organization permissions", not "Repository permissions". Without
   it, `octokit.repos.createInOrg` returns 403 and the Session API
   surfaces the failure on every new-app POST.
7. **Repository permissions** (applies to all repos in the org):
   - `Contents` → `Read and write` (clone + push).
   - `Metadata` → `Read` (auto-included by GitHub; cannot be
     unchecked).
   Leave everything else at "No access".
8. Click "Generate token". Copy the token immediately — GitHub will
   not show it again.

## Step 3 — Populate and apply the Secret

```sh
cp infra/local/github-platform-creds-secret.yaml.example \
   infra/local/github-platform-creds-secret.yaml
```

Edit `infra/local/github-platform-creds-secret.yaml` and replace
`<YOUR_PAT_HERE>` in `stringData.token` with the token from step 2.

Apply:

```sh
kubectl apply -f infra/local/github-platform-creds-secret.yaml
kubectl get secret github-platform-creds -n openvoid-sessions
```

The populated manifest is gitignored (the `.example` file is committed,
the real one is not). Do not commit a populated copy.

## Step 4 — Override the org name (only if you picked a different name)

If your org name is not `openvoid-platform`, edit the env on the
Session API Deployment in `infra/local/session-api.yaml`:

```yaml
- name: OPENVOID_PLATFORM_GITHUB_ORG
  value: "<your-org-name>"
```

Tilt re-applies on save. On DOKS, edit the chart values (Phase 9) or
the Deployment directly until then.

## Step 5 — Restart the Session API

The Session API reads the Secret once at boot. After applying the
Secret and (optionally) the env, restart the Deployment so the new
value is picked up:

```sh
kubectl rollout restart deployment session-api -n openvoid-system
kubectl rollout status   deployment session-api -n openvoid-system
```

## Step 6 — Verify

```sh
kubectl logs -n openvoid-system deploy/session-api | grep -i 'github-platform-creds'
```

Expected: a line confirming the Secret was read at boot. If the log
shows an error (`Cannot read Secret ...`, `missing key "token"`, or a
401 against GitHub), re-check step 2's permissions and step 3's
manifest content.

The end-to-end happy path is a `POST /sessions { mode: "new-app" }`
that returns 201 with a `sessionId` and creates a repo under the org;
you can verify by listing the org's repos in the GitHub UI after the
session starts.

## Rotation

1. Generate a new PAT (step 2 of this runbook).
2. Update `stringData.token` in `infra/local/github-platform-creds-secret.yaml`.
3. `kubectl apply -f infra/local/github-platform-creds-secret.yaml`.
4. `kubectl rollout restart deployment session-api -n openvoid-system`.
5. Revoke the old PAT in https://github.com/settings/personal-access-tokens.

The old PAT must be revoked **after** the rollout finishes so there is
never a window where the live Deployment is holding a revoked token.

## Known v1 limitations

- **Single-replica idempotency.** The `Idempotency-Key` cache lives in
  the Session API process. The v1 manifest pins `replicas: 1`; do not
  scale this Deployment until a distributed idempotency store lands
  (v1.5).
- **Pod-orphan on partial failure.** If the Session API successfully
  creates a repo on GitHub but the subsequent Pod creation fails and
  rolls back, the repo remains. v1 cleanup is manual — visit the org
  in the GitHub UI and delete orphaned repos that have no associated
  active session. v1.5 introduces a reconciliation job.
- **No returning-user surface.** App repos persist on the platform org
  but landing does not expose them after the session ends. The org's
  GitHub UI is the only way to inspect prior apps in v1.
