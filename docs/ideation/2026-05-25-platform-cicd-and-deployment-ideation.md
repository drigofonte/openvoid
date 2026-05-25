---
date: 2026-05-25
topic: platform-cicd-and-deployment
focus: deployment architecture and CI/CD for the OpenVoid platform itself and for user apps published to OpenVoid-controlled infra
mode: conversation-grounded
related:
  - docs/ideation/2026-05-23-roadmap-to-public-do-release-ideation.md
  - docs/architecture/secrets-threat-model.md
  - docs/architecture/secrets-sequence-diagrams.md
  - docs/architecture/secrets-device-requirements.md
---

# Ideation: Platform CI/CD and Deployment Architecture

This document is the Item 2 ideation pass from the roadmap refinement on 2026-05-24. It covers how the OpenVoid platform itself is deployed (infrastructure provisioning, CI/CD, observability, secrets bootstrap) and how user apps are deployed to OpenVoid-controlled DOKS infrastructure once they exist. The boundary between Item 2 (platform) and Item 3 (user apps) is intentionally blurred because they share most primitives — the apps-prod cluster, ArgoCD, the registry, the observability stack — and treating them as one architecture surfaces the leverage.

## Grounding context

Prior decisions from the 2026-05-23 roadmap ideation and 2026-05-24 refinement that constrain this document:

- **Cluster topology.** Three DOKS clusters for first release: `platform-dev`, `platform-prod`, `apps-prod`. An `apps-dev` cluster is explicitly deferred — for the first release, user app deployments go straight to `apps-prod` in their own per-app namespaces.
- **Deployment preference.** Push-based for the platform; pull-based (ArgoCD) for in-cluster workloads. The hybrid is captured below as decision #1 and supersedes the earlier "ArgoCD is not the right pattern" stance from the 2026-05-23 ideation (rejection R7.7 in the roadmap doc).
- **CI runner.** GitHub Actions.
- **Image registry.** Cheapest option — GHCR (free for public, included in GitHub plan for private).
- **Observability stack.** Prometheus + Grafana family.
- **Secrets architecture.** OpenBao deployed in-cluster as a v1 commitment per survivor 9; see `docs/architecture/secrets-threat-model.md`. Bootstrap secrets (OpenBao unseal keys, platform PAT, age key) are out of OpenBao by definition.
- **Audience.** Sophisticated users accelerating their own work. Solo operator (one human) at v1; design must survive 1-operator on-call rotation.
- **Tenancy.** Many-users / one-platform-owned source-control account (memory: `project_tenancy_model.md`).

Open questions resolved during the conversation that produced this doc are captured in the **Rejection summary** at the bottom.

---

## Ranked decisions

### 1. Terraform for cloud-level infrastructure + ArgoCD for all in-cluster workloads

**Description:** Two-tool split with a clean seam. **Terraform** manages everything outside the cluster: DOKS cluster provisioning itself, DNS records (apex and wildcards), GHCR repository configuration, DO Spaces buckets (for OpenBao snapshots, image-layer caching if needed, app-published static assets), DO project-level resources, firewalls, the *initial* in-cluster install of ArgoCD via `terraform-helm-provider` (one Helm release, the bootstrap of bootstraps). **ArgoCD** manages everything inside the cluster from that point forward: platform services (landing, session-api, OpenBao itself, ingress-nginx, cert-manager, the Prometheus stack, Loki, Alertmanager) *and* user apps via ApplicationSet (decision #3). Same in-cluster deployment pattern for the platform's own services and for user-published apps.

**Warrant:** `direct:` Rodrigo's stated preference 2026-05-25 ("Terraform for infra and Argo for cluster resources"). `external:` This split matches the established DOKS + ArgoCD pattern documented widely in CNCF case studies — Terraform handles cloud-provider IaC where its state model shines; ArgoCD handles continuous reconciliation of Kubernetes manifests where its controller loops shine. Using Terraform's K8s provider for in-cluster manifests is technically possible but loses Helm ecosystem ergonomics. `reasoned:` Self-healing matters in-cluster (a deleted Deployment should come back; a drifted ConfigMap should be corrected) and matters less at the cloud-resource level (a deleted DOKS cluster is a known incident, not silent drift). Matching the tool to the workload's actual lifecycle is the leverage move.

**Rationale:** One in-cluster deployment pattern is operationally simpler than two — when something in the cluster breaks, the answer is always "check ArgoCD." Helm charts for platform services and user-app manifests both flow through the same reconciler with the same RBAC, same audit trail, same UI. The "Argo for everything in-cluster" framing is actually cleaner than the original "push-for-platform / pull-for-apps" hybrid I proposed because it removes a category boundary that has no operational reason to exist.

**Downsides:** ArgoCD becomes the highest-blast-radius asset in any cluster it's installed on — full admin within its scope. Mitigations: separate ArgoCD instances per cluster (no central ArgoCD controlling everything), tight RBAC on ArgoCD itself, audit log shipped off-cluster, no SSO admin escalation paths beyond a tightly-scoped break-glass account. Terraform-installing-ArgoCD is a small chicken-and-egg (the bootstrap deploy uses `terraform-helm-provider` directly, not ArgoCD); this is fine as a one-time install but means ArgoCD upgrades go through Terraform too, slightly off-pattern.

**Confidence:** 90%
**Complexity:** Medium (Terraform skeleton + ArgoCD install module + RBAC + per-cluster instance design)
**Status:** Decided 2026-05-25

### 2. Three-cluster topology: platform-dev + platform-prod + apps-prod

**Description:** Three DOKS clusters at first release. **`platform-dev`** runs the OpenVoid platform's own services (landing, session-api, OpenBao, observability stack) for development and pre-prod validation. **`platform-prod`** runs the same stack in production — what real users hit. **`apps-prod`** runs published user apps, one namespace per app, fully isolated from the platform clusters via separate DOKS projects and no shared networking. No `apps-dev` cluster at first release (decided 2026-05-25); user apps that need a pre-prod target wait until graduation to open signup, at which point an `apps-dev` cluster is reasonable.

**Warrant:** `direct:` Rodrigo's stated preference 2026-05-24 ("Separate clusters for platform and apps") + 2026-05-25 ("Not for the first release" on apps-dev). `reasoned:` Co-locating user apps with the platform on a shared cluster means a malicious or misbehaving user app can attempt cross-namespace pivots against the platform — NetworkPolicy mitigates but does not eliminate. Separate clusters is the structural answer. The dev/prod split for the platform is conventional and lets you validate cluster-level changes (operator upgrades, ingress reconfig) before they hit users. `external:` Multi-cluster topology is the recommended pattern for any K8s deployment that mixes trusted (platform) and semi-trusted (user-controlled) workloads — CNCF security guidance, OWASP K8s top-10 both flag co-tenancy as a known risk.

**Rationale:** The blast-radius separation is the load-bearing argument: a compromised user app on `apps-prod` cannot reach `platform-prod` (no shared network, separate API servers, separate DOKS projects, separate ArgoCD instances). For a sophisticated-user audience that will eventually build apps with their own external dependencies, this isolation is the difference between "a user app got popped" and "OpenVoid got popped."

**Downsides:** ~$216/month minimum DOKS cost for 3 small clusters (3 × $72/month for the smallest sensible node pool). Operator overhead of three clusters to monitor, upgrade, patch. Terraform state file per cluster (or per-environment workspace) adds module complexity. Observability spans clusters and needs cross-cluster aggregation (the Prometheus stack in decision #6 addresses this).

**Confidence:** 85%
**Complexity:** Medium (Terraform modules per cluster + cross-cluster Prometheus federation or remote write + multi-cluster ArgoCD setup)
**Status:** Decided 2026-05-25

### 3. ArgoCD ApplicationSet with Plugin generator for dynamic user-app registration

**Description:** User apps are registered with ArgoCD on `apps-prod` via an **ApplicationSet** that uses the **Plugin generator** to call an OpenVoid Session API endpoint (`GET /internal/apps/active`) for the current list of published apps. Each entry in the response includes app metadata (slug, owner, target namespace, image reference, resource limits, runtime env-from references for OpenBao secrets). ArgoCD generates one `Application` per entry, deploys the app's Helm chart (a single chart parameterised per app, *not* per-app custom charts), reconciles continuously. When a user publishes a new app, Session API includes it in the next plugin response; ArgoCD picks it up within the configured generator poll interval (default 3 minutes). Deletion mirrors: user unpublishes → Session API drops it from the response → ArgoCD prunes the Application + namespace.

**Warrant:** `direct:` The Plugin generator is the cleanest fit for OpenVoid's tenancy model — the platform Session API is already the source of truth for "what apps exist for which users." `external:` ArgoCD ApplicationSet documentation explicitly supports HTTP-Plugin generators for exactly this dynamic-registration use case; the SCM Provider generator is the alternative but requires ArgoCD to be the one querying GitHub directly, which duplicates state. `reasoned:` Plugin generator returning structured metadata gives Session API one HTTP endpoint to maintain rather than coupling ArgoCD to repo-naming conventions, GitHub topics, or any other convention that might drift.

**Rationale:** Dynamic registration without manual `Application` YAML per app is the only viable pattern at 50-cohort-users × 1-2-apps scale. Plugin generator keeps the source of truth in OpenVoid (where it belongs given the tenancy model) instead of in ArgoCD configuration files. Single shared Helm chart parameterised per-app means platform-side changes (e.g., adding a new sidecar) update all apps at once via Helm chart version bump, no per-app manifest editing.

**Downsides:** Plugin generator is a less-trodden ArgoCD path than List or Git generators — fewer Stack Overflow answers, more reading of source code likely. The shared Helm chart for all user apps is a real abstraction commitment: changes to the chart deploy to every app at once, so backwards-compatibility within the chart's value schema becomes load-bearing. Plugin endpoint becomes a critical-path dependency for app deploys — if Session API is down, ArgoCD can't refresh app inventory (mitigated by ArgoCD caching the last successful response).

**Confidence:** 75%
**Complexity:** Medium (Plugin generator + single shared chart + Session API endpoint + per-app values templating)
**Status:** Recommended; pending implementation validation

### 4. SOPS-encrypted bootstrap secrets with `age` key in GitHub Actions → OpenBao after first boot

**Description:** The chicken-and-egg of "deploy OpenBao without OpenBao to hold the secrets" is resolved via SOPS-encrypted bootstrap. Terraform variables containing the platform PAT, OpenBao initial unseal keys, TLS bootstrap material, and DO API tokens live SOPS-encrypted in the platform repo. CI decrypts them at `terraform apply` time using an `age` private key held as a GitHub Actions environment secret. After OpenBao is alive in `platform-prod` and has been unsealed (the 3-of-5 Shamir-split unseal keys are recorded in 1Password, distributed to operators), all *new* secrets land in OpenBao via the architecture in `docs/architecture/secrets-threat-model.md`. The SOPS-encrypted bootstrap secrets are the *minimum* — they should not grow over time; anything new defaults to OpenBao.

**Warrant:** `direct:` The bootstrap problem is real and unavoidable; some root-of-trust must exist outside OpenBao. `external:` SOPS + age is the CNCF-blessed pattern for git-stored encrypted secrets, used by Flux, ArgoCD's Vault plugin, and most production GitOps deployments. `reasoned:` Concentrating the root of trust in a small, audited set of secrets (just the things needed to bring OpenBao online) bounds the blast radius — a compromised age key + compromised CI runner exposes only the bootstrap secrets, not the per-user secrets that live in OpenBao under the layered architecture.

**Rationale:** Acknowledges the fundamental fact: there is always a root of trust *somewhere*. SOPS + age + GitHub Actions environment secret is a defensible root for a solo operator. The 1Password custody of the age key gives an offline copy if the GitHub secret is ever compromised; the Shamir split of OpenBao's unseal keys gives an independent recovery for OpenBao itself even if SOPS is compromised.

**Downsides:** Age key custody is the highest-blast-radius single secret in the entire system (it can decrypt everything that bootstraps OpenBao). If lost, everything must be rotated; if leaked, everything bootstrap-level is compromised. Mitigation: 1Password vault item with the operator as the *only* member, GitHub Actions environment-scoped secret with production-environment manual-approval gating, scheduled rotation (quarterly) with documented rotation runbook.

**Confidence:** 85%
**Complexity:** Medium (SOPS tooling setup + Terraform integration + key-custody runbook + rotation procedure)
**Status:** Decided 2026-05-25

### 5. GHCR for container images; cosign signing in CI; Kyverno verifying admission

**Description:** Container images for platform services (landing, session-api, the three pod images, OpenBao, observability components if customised) live in GHCR under `ghcr.io/openvoid-platform/*`. CI builds images on tagged commits, signs them with **cosign** using a private key held as a GitHub Actions secret (separate from the age key — different key per concern), and pushes signed images to GHCR. In each cluster, **Kyverno** runs as an admission controller and refuses to schedule any pod whose image is not signed by the cosign public key. Same pattern for user apps: their images are built in CI and signed before going to GHCR; the apps-prod cluster's Kyverno policy enforces signature verification before scheduling.

**Warrant:** `direct:` The threat model assumption A6 explicitly requires image attestation (`cosign + Kyverno admission`) — this decision implements it. `external:` Sigstore / cosign is the CNCF-graduated standard for container image signing; Kyverno is the leading K8s-native policy engine for admission control. `reasoned:` GHCR is free at OpenVoid's expected volume (50 cohort users × infrequent image builds) and avoids the per-region cost of DO Container Registry. The signing chain blocks the supply-chain attack class enumerated as T10 in the threat model.

**Rationale:** Signed images + admission verification is the structural defence against tampered images getting scheduled — without it, any compromise of the registry or the pull path lets attackers ship arbitrary code. Cosign is comparatively cheap to add at the start; retrofitting it after a year of unsigned images is a real migration.

**Downsides:** Adds CI complexity (signing step in every build), adds admission complexity (Kyverno policies to maintain, debug, monitor). Cosign signing key custody is non-trivial — Sigstore's keyless mode using GitHub OIDC is the modern best-practice and avoids long-lived signing keys, but the verification side becomes more involved (Rekor transparency log lookup).

**Confidence:** 80%
**Complexity:** Medium-High (cosign setup + Kyverno policies + GitHub OIDC integration for keyless signing if chosen)
**Status:** Recommended; keyless-vs-keyed cosign mode pending decision

### 6. Prometheus + Grafana + Loki + Alertmanager observability across all three clusters

**Description:** One Grafana instance lives on `platform-prod`; Prometheus runs in each cluster scraping local targets and remote-writing aggregated metrics to a central long-term store (likely a separate Prometheus instance on `platform-prod` configured for long retention, or Mimir / Thanos if cohort scale justifies it). Loki runs in each cluster collecting logs and remote-writing to a central Loki on `platform-prod`. Alertmanager runs on `platform-prod` only and routes alerts to the operator's notification surface (email + push via a single channel for v1; can split later). Dashboards are stored as JSON in the platform repo and deployed via ArgoCD (Grafana's filesystem provider) so they are versioned and reviewable.

**Warrant:** `direct:` Rodrigo's preference for Prometheus + Grafana. `external:` This is the canonical observability stack for K8s deployments; documented to death in CNCF and Grafana Labs material. `reasoned:` Centralising Grafana and Alertmanager means one dashboard, one alert routing config. Per-cluster Prometheus + Loki keeps the data plane local (fast scrapes, no cross-cluster latency) while the control plane is central (one place to look). Pacing Mimir/Thanos until cohort scale demands it keeps the initial setup tractable.

**Rationale:** Solo-operator on-call requires observability that prioritises "what is currently broken" over "what was broken three months ago." The recommended stack delivers that. Long-term metrics retention can wait until you have a reason to want it; for v1, two weeks in Prometheus is enough to investigate any incident worth investigating.

**Downsides:** Prometheus + Loki + Grafana + Alertmanager are a meaningful operational surface — four components to upgrade, monitor for themselves, keep in sync version-wise. For a solo operator this is non-trivial but unavoidable. Alternative DO Managed Monitoring would be cheaper to operate but worse to debug (less control, smaller ecosystem). Worth revisiting at graduation if the observability operational tax becomes painful.

**Confidence:** 80%
**Complexity:** Medium-High (kube-prometheus-stack Helm chart deployment + Loki deployment + cross-cluster remote-write + dashboard versioning + alert routing config)
**Status:** Decided 2026-05-25 (stack); deployment details pending

### 7. OpenBao backup: scheduled raft snapshots to DO Spaces, separately-encrypted, quarterly restore drill

**Description:** OpenBao runs in raft storage mode (single-node at v1; HA at graduation). A **CronJob in `platform-prod`** runs every 6 hours, takes a raft snapshot via OpenBao's `/sys/storage/raft/snapshot` endpoint, encrypts the snapshot with an `age` key (different from the bootstrap age key — separation of concerns), uploads to a versioned DO Spaces bucket. **30-day retention** of hourly-spaced snapshots, plus weekly snapshots retained for 1 year. **Quarterly restore drill**: spin up a temporary OpenBao instance, restore the most recent snapshot, verify a sample of secrets can be decrypted by the user-KEK + recovery-code flow, tear down. Drill is calendar-scheduled and the runbook is checked in.

**Warrant:** `direct:` OpenBao is the highest-blast-radius dependency in the platform — losing its data permanently means every user loses their stored secrets, with no recovery path beyond "every user re-enters their keys" (assuming users still have them). Threat model T4 explicitly identifies backup leakage as a risk; the *separately-encrypted* snapshot addresses that. `external:` Vault's official documentation requires periodic snapshots for any production deployment; OpenBao inherits this requirement. `reasoned:` A backup that is never restore-tested is not a backup. The quarterly drill converts "we have backups" from a claim into a verified fact.

**Rationale:** This is the operational decision that determines whether OpenVoid can survive a cluster-loss event. Without it, a DO regional outage or a destructive operator mistake takes down every user's stored secrets permanently. With it, the worst case is a 6-hour data loss window plus the time to restore.

**Downsides:** Snapshot encryption key custody is another high-blast-radius single secret — must live in 1Password, separate from the bootstrap age key, with its own rotation cadence. Quarterly restore drill is real ongoing work — easy to skip when busy. The DO Spaces bucket containing snapshots is itself a target — bucket policies must restrict to platform-prod's egress IP plus a single operator account.

**Confidence:** 85%
**Complexity:** Medium (snapshot CronJob + encryption + Spaces bucket + restore runbook + drill scheduling)
**Status:** Decided 2026-05-25

### 8. Drift detection: scheduled `terraform plan` daily, ArgoCD's built-in for in-cluster

**Description:** **For cloud-level resources (Terraform-managed):** a scheduled GitHub Actions workflow runs `terraform plan` daily against each environment. Any non-empty plan output posts to the operator's notification channel as a drift alert. The expected state is "zero diff"; non-zero is investigated. **For in-cluster resources (ArgoCD-managed):** ArgoCD's built-in OutOfSync detection runs continuously by design — drift is detected within the reconciler poll interval (default 3 minutes) and either auto-corrected (default behaviour, recommended) or flagged for manual sync. ArgoCD UI shows drifted resources prominently.

**Warrant:** `direct:` The push-based pattern for Terraform doesn't get drift detection for free, so it must be added explicitly. `reasoned:` Daily cadence is adequate for cloud resources, which change rarely. ArgoCD's existing continuous reconciliation covers the higher-velocity in-cluster surface naturally.

**Rationale:** Closes the gap that a critic might raise against the push-based-for-cloud decision. Drift is detected on both sides; no surface is left to silently rot.

**Downsides:** Daily plan jobs burn CI minutes (small — a `plan` is fast). False positives from upstream provider changes (e.g., a new optional field added) generate noise that must be quickly distinguished from real drift. ArgoCD auto-sync can be wrong if a manual intervention was the *intended* state (rare but possible during incidents); the answer is to disable auto-sync per-Application during active incidents.

**Confidence:** 75%
**Complexity:** Low (scheduled workflow + notification routing)
**Status:** Decided 2026-05-25

### 9. Skip per-PR ephemeral environments for v1; revisit at team > 1 or open signup

**Description:** No per-PR ephemeral environments for the platform repo at v1. Merge-to-main triggers a deploy to `platform-dev` via GitHub Actions → Terraform/Helm; manual approval (GitHub environment protection rule) gates promotion to `platform-prod`. Same flow for user apps as it lands: a user's app deploy happens on push to their app's branch (or on explicit publish from the OpenVoid UI), not per-PR.

**Warrant:** `direct:` Solo-operator team — there is no one to share PRs with. The value of per-PR envs comes from N-reviewer × M-PR parallelism. `external:` Per-PR envs are a well-documented best practice at team scale (Vercel, Netlify, Render all offer them as a flagship feature); the threshold where they pay back is when more than 2 engineers are reviewing each other's work in parallel. `reasoned:` The engineering cost (spin-up workflow + teardown workflow + abandoned-PR cleanup + per-env OpenBao access + per-env DNS + per-env secret staging) is real and not free.

**Rationale:** YAGNI applied to the operational surface. Adding per-PR envs costs weeks of engineering for value that doesn't exist at a one-operator scale.

**Downsides:** Loss of "deploy-preview-style" reviewability for platform changes — but for a solo operator, "merge to main and look at platform-dev" is the same thing with one fewer ceremony. Loss of the muscle for "easily reproducing prod in a fresh env" — but the broader observability + backup work covers most of the same need.

**Confidence:** 85%
**Complexity:** Trivial (a deliberate non-decision)
**Status:** Decided 2026-05-25; revisit triggers documented

---

## Cross-cutting observations

- **The hybrid is two patterns matched to two workload shapes.** Terraform for cloud (slow-changing, complex state, operator-driven). ArgoCD for in-cluster (high-velocity, self-healing-valuable, declarative-friendly). This is a more honest fit than "one pattern for everything."
- **ArgoCD is the new highest-blast-radius asset.** Per-cluster ArgoCD instances (no central one), tight RBAC, audit shipped off-cluster, no SSO admin escalation paths. Goes in the threat model as a future addendum.
- **The age key for SOPS is the root of trust.** Lose it → re-encrypt everything; leak it → every bootstrap secret is compromised. This deserves the same operational attention as the OpenBao unseal keys, possibly more (because it's used more often).
- **OpenBao backup is the most under-discussed component in the whole architecture.** It's also the difference between "regional DOKS outage = 6 hours of data loss" and "regional DOKS outage = every user loses everything they ever stored." Quarterly restore drill is non-negotiable.
- **Three-cluster cost floor: ~$216/month minimum.** Acceptable for the architecture clarity it buys; revisit only if cohort revenue model (currently: zero, by BYOK design) becomes a constraint.
- **The Plugin generator pattern for ArgoCD makes Session API a critical-path dependency for app deploys.** Worth designing the Plugin endpoint with explicit caching semantics so ArgoCD can survive Session API being briefly down without blocking deploys.

## Suggested sequencing (within Phase A — 8 to 14 weeks)

| Week | Focus | Deliverable |
|---|---|---|
| 1–2 | Terraform skeleton + DOKS provisioning | platform-dev cluster up; Terraform modules for cluster + DNS + GHCR + Spaces |
| 2–3 | ArgoCD bootstrap on platform-dev | ArgoCD installed via terraform-helm-provider; one test Application reconciling |
| 3–4 | SOPS + bootstrap secrets | age key in GitHub Actions; first SOPS-encrypted vars decrypting at apply; platform-prod cluster up via same path |
| 4–6 | OpenBao deployment + integration | OpenBao running on platform-prod; manual unseal documented; Session API talking to OpenBao via K8s auth |
| 5–7 | Platform services deployed via ArgoCD | landing + session-api Helm charts deployed via ArgoCD on platform-prod; ingress-nginx + cert-manager up |
| 6–8 | Observability stack | Prometheus + Loki on each cluster; Grafana + Alertmanager central on platform-prod; first dashboards and alerts |
| 7–9 | cosign + Kyverno | Image signing in CI; Kyverno admission policies enforcing verification |
| 8–10 | OpenBao backup + first restore drill | Snapshot CronJob running; first restore drill completed and documented |
| 9–11 | apps-prod cluster + ArgoCD ApplicationSet | apps-prod up; ApplicationSet with Plugin generator; first test user-app deployed end-to-end |
| 10–12 | User-app shared Helm chart + Session API publish endpoint | Single Helm chart parameterised per app; OpenVoid UI publish action triggers an entry in the Plugin endpoint response |
| 11–13 | Drift detection + runbooks | Scheduled terraform-plan workflow; on-call runbook (auth, secrets, deploy, restore-from-snapshot) |
| 13–14 | Pre-cohort dress rehearsal | Internal red-team pass; restore drill; intentional incident simulation; final go/no-go for cohort opens |

This timeline is the honest "8–14 weeks" estimate from the roadmap phasing table, expanded.

## Rejection summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| C1.1 | Terraform-for-everything (incl. in-cluster manifests via terraform-kubernetes-provider) | Loses Helm ecosystem ergonomics; in-cluster workloads benefit more from a continuous reconciler than from periodic apply |
| C1.2 | ArgoCD-for-everything (incl. cloud-level via Crossplane) | Crossplane is a real option but adds another component to operate; Terraform's cloud-resource ergonomics + state model are better fit at solo-operator scale |
| C1.3 | Push-based deployment for user apps (Terraform per app) | Doesn't scale — burns CI minutes linearly with deploy count; doesn't provide self-healing; doesn't match the app workload's high-velocity / many-instances shape |
| C1.4 | Single cluster with namespace isolation between platform and user apps | Co-tenancy of trusted and semi-trusted workloads on shared API server / shared network is a known anti-pattern; structural isolation via separate clusters is the right answer |
| C1.5 | apps-dev cluster at first release | Deferred per 2026-05-25 decision; revisit at graduation to open signup |
| C1.6 | Per-PR ephemeral environments | YAGNI at solo-operator scale; revisit at team > 1 |
| C1.7 | DO Container Registry instead of GHCR | DOCR has per-GB pricing where GHCR is effectively free; in-region locality has negligible benefit at OpenVoid's image-pull volume |
| C1.8 | Self-hosted CI runners on the cluster | GitHub Actions hosted runners are cheaper at OpenVoid's expected CI volume; self-hosted runners add operational surface (runner OS patching, scaling) without payback until very high CI volume |
| C1.9 | DO Managed Monitoring instead of Prometheus + Grafana | DO Managed is cheaper to run but less debuggable; Prometheus/Grafana is the industry standard and the skills transfer |
| C1.10 | SCM Provider generator for ArgoCD ApplicationSet | Plugin generator is the better fit because it keeps the source of truth (which apps exist) in OpenVoid rather than in repo-naming conventions; SCM is the right pattern when ArgoCD itself owns the "what to deploy" decision |
| C1.11 | Central ArgoCD controlling all three clusters | Concentrates blast radius across cluster boundaries; per-cluster ArgoCD instances preserve the cluster-isolation property of decision #2 |
| C1.12 | OpenBao backup as standalone Velero install | Velero is a strong K8s-cluster-backup tool, but OpenBao raft snapshots via OpenBao's own API are the OpenBao-native answer; Velero adds another component to operate without a clear win for this specific use case |
| C1.13 | Image-pull-secrets in K8s for GHCR auth | GHCR supports OIDC-based pull credentials via Workload Identity-style auth (a GitHub Actions OIDC token exchanged for a GHCR pull token); avoids long-lived registry credentials in K8s |
| C1.14 | Mimir / Thanos for long-term metrics from day one | Premature — vanilla Prometheus retention is enough until cohort feedback identifies long-term metrics as a real need |
| C1.15 | Keyed cosign signing with long-lived signing key | Sigstore's keyless mode (via GitHub OIDC + Rekor transparency log) is the modern best-practice; avoids signing-key custody. Open decision; flagged in #5 |

## Open questions to address before implementation

1. **Cosign keyless vs keyed mode** — decision #5 leaves this open. Keyless (Sigstore OIDC + Rekor) is the modern best-practice but adds Rekor as a dependency. Worth a brief follow-up decision.
2. **Multi-cluster Prometheus aggregation** — decision #6 says "central remote-write target" without specifying. Options: a second Prometheus on platform-prod, Mimir, Thanos. Default to the second-Prometheus approach (simplest) until scale forces an upgrade.
3. **OpenBao HA at v1 vs graduation** — single-node OpenBao is much simpler; HA is required for genuine zero-downtime maintenance. Defaulting to single-node + 6-hourly snapshots for v1, but worth an explicit decision.
4. **GitHub Actions OIDC for cloud provider auth** — should Terraform's DO credentials come from a GitHub Actions OIDC trust relationship (better) or from a long-lived API token in Actions secrets (simpler)? Open.
5. **Operator on-call expectations** — what's the SLA for the operator (you)? 24/7? Business hours? This shapes alert routing and runbook tone. Out of scope for this doc but needed before cohort opens.
