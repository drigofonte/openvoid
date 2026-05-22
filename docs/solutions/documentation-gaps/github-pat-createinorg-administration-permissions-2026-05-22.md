---
title: GitHub fine-grained PAT needs BOTH Org and Repo Administration to create org repos
date: 2026-05-22
category: documentation-gaps
module: platform-github-org-setup
problem_type: documentation_gap
component: tooling
severity: high
applies_when:
  - "Creating org repos via `POST /orgs/{org}/repos` (octokit `repos.createInOrg`, `gh repo create <org>/<name>`, or raw curl)"
  - "Issuing a fine-grained PAT for a platform-owned GitHub organization"
  - "Following GitHub's official REST permission docs at face value"
symptoms:
  - "API returns `403 \"Resource not accessible by personal access token\"` on createInOrg"
  - "Org → Administration: Read+write is set per GitHub docs, but the call still 403s"
  - "Repo → Contents: R/W and Metadata: R alone are insufficient even with the Org Admin grant"
related_components:
  - authentication
  - development_workflow
tags:
  - github
  - github-api
  - octokit
  - fine-grained-pat
  - permissions
  - org-repos
  - documentation-gap
---

# GitHub fine-grained PAT needs BOTH Org and Repo Administration to create org repos

## Context

GitHub's REST docs for [`POST /orgs/{org}/repos`](https://docs.github.com/en/rest/repos/repos#create-an-organization-repository) list **Organization → Administration: Read and write** as the privileged scope a fine-grained PAT needs to create repositories inside an org. The openvoid platform's "new app" entry point calls this endpoint via `octokit.rest.repos.createInOrg` to spin up a per-app repo on the platform org for every session. Following the docs verbatim — Org Administration: R/W, Repository Contents: R/W, Repository Metadata: R (auto) — still returned:

```
403 "Resource not accessible by personal access token"
```

The error names neither the missing permission nor the scope level. The investigation arc that surfaced the real requirement (session history):

1. PAT was created with the documented scope set. Read endpoints (`GET /orgs/{org}`, `GET /orgs/{org}/repos`) returned `200`; `POST /orgs/{org}/repos` returned `403`.
2. Ruled out as causes: PAT pending org approval (org policy was already set to "Do not require administrator approval"); wrong Resource Owner on the token; org-level fine-grained PAT policy denying access; accidental classic-vs-fine-grained PAT confusion.
3. Cross-checked the org's "Active tokens" view at `https://github.com/organizations/<org>/settings/personal-access-tokens` — the org-side accepted permissions matched the user-side configured permissions exactly.
4. The fix was adding **Repository permissions → Administration: Read and write** in addition to the Org-level Administration grant. The 403 cleared immediately.

A subtle UI quirk amplifies the trap: the "Repository permissions" section on the PAT creation form is collapsed by default and **only appears after `Repository access` is set to "All repositories"**. Operators who scroll straight from the Resource Owner selection to the Org permissions section won't see the Repo Administration row at all and won't know they missed it.

## Guidance

A fine-grained PAT that calls `POST /orgs/{org}/repos` must have **Administration: Read and write set on BOTH the Organization permissions section AND the Repository permissions section** of the token. GitHub's docs only mention the Organization-level grant. The Repository-level grant is empirically required.

Minimum working permission matrix for `repos.createInOrg`:

| Scope level  | Permission     | Access           |
| ------------ | -------------- | ---------------- |
| Organization | Administration | Read and write   |
| Repository   | Administration | Read and write   |
| Repository   | Contents       | Read and write   |
| Repository   | Metadata       | Read-only (auto) |

Diagnostic curl recipe to confirm the failure mode before editing permissions. Set `TOKEN=github_pat_...` and `ORG=your-org`:

```bash
# 1. Token authenticates? (needs Metadata: Read — auto-included)
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/orgs/$ORG

# 2. Token can READ org repos? (needs Contents: Read)
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/orgs/$ORG/repos

# 3. Token can CREATE org repos? (needs BOTH Administration grants)
curl -sS -i \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -X POST https://api.github.com/orgs/$ORG/repos \
  -d '{"name":"perm-probe-delete-me","private":true,"auto_init":false}'
```

Expected failing pattern: first two return `200`, the third returns `403 "Resource not accessible by personal access token"`.

Expected post-fix pattern: all three return `2xx`. Clean up with `DELETE /repos/$ORG/perm-probe-delete-me`.

If the read calls themselves 403, the cause is upstream of this learning (PAT pending approval, wrong Resource Owner, or org-level fine-grained PAT policy restriction) — fix that first.

## Why This Matters

GitHub's own documentation is incomplete on this endpoint, and the 403 error is opaque — it doesn't say "you're missing Repository → Administration." Operators reasonably trust the docs, configure exactly what's listed, and then burn hours bisecting their automation: re-issuing tokens, second-guessing the org's PAT policy, suspecting an Octokit bug, even regenerating the PAT from scratch. The fix is a single checkbox in a section the docs never told you to look at, often hidden behind a UI gate they also never mentioned.

For platform-tenancy designs where a single PAT is the load-bearing credential for repo provisioning (as in openvoid's "one platform-owned source-control account, many users" model), getting this wrong blocks every new-app session until fixed. The runbook now documents the requirement; this learning is the searchable artifact a future operator will find when grepping for the 403.

## When to Apply

- Any fine-grained PAT that needs to create repositories in an organization via `POST /orgs/{org}/repos` — whether called through Octokit (`repos.createInOrg`), `gh repo create <org>/<name>`, or raw curl.
- Worth verifying (likely same pattern) for other org-administers-repo endpoints: repo transfer, repo deletion, repo settings mutation invoked at the org level. If you hit a 403 on one of these with only Organization-level Administration set, add Repository-level Administration before deeper debugging.
- Does **not** apply to user-owned repo creation (`POST /user/repos`), which uses a different permission surface.

## Examples

The diagnostic curl sequence above reproduces the bug in 3 calls and verifies the fix. For PAT creation, the order that avoids the UI gate is:

1. Visit https://github.com/settings/personal-access-tokens/new.
2. Set **Resource owner** to the target org.
3. Set **Repository access** to **"All repositories"** — this is what makes the Repository permissions section appear below.
4. Expand **Organization permissions → Administration** → Read and write.
5. Expand **Repository permissions → Administration** → Read and write.
6. Expand **Repository permissions → Contents** → Read and write (Metadata auto-fills).
7. Generate the token.

Skipping step 3 hides the Repository permissions section and silently leads to the misconfiguration.

## Related

- [`docs/runbooks/platform-github-org-setup.md`](../../runbooks/platform-github-org-setup.md) — operator-facing setup runbook. Step 3 documents both Administration rows as required, with the same empirical caveat. Updated in commit `bd017e9`.
- [`infra/local/github-platform-creds-secret.yaml.example`](../../../infra/local/github-platform-creds-secret.yaml.example) — Secret manifest header comment carries the same quick-reference permission table.
- [`docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md`](../../plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md) — historical v1 plan. Discusses fine-grained PAT strategy + tenancy model but predates this discovery and lists only Org-level Administration as required. Worth a forward-link to the runbook from the PAT section if it's ever refreshed.
