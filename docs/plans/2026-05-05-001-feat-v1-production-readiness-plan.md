---
title: "feat: v1 production readiness — DOKS, Helm, safety rails"
type: feat
status: active
date: 2026-05-05
revision: 1
origin: docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md
parent_phases_complete: [0, 1, 2, 3, 4, 5, 6, 7]
companion: docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md
---

# v1 Production Readiness — DOKS, Helm, Safety Rails

## Overview

This plan tracks the remaining v1 milestone work after Phase 7 closed. It is a **continuation** of [`2026-05-01-001-feat-v1-staged-walkthrough-plan.md`](2026-05-01-001-feat-v1-staged-walkthrough-plan.md) (the parent plan). Phases 0–7 are complete and shipped; the parent plan remains the historical record and the source of truth for:

- All architectural decisions, rev history, threat model, and key technical choices.
- Phases 0–7 implementation units (what shipped, where, and why).
- Cross-platform parity matrix (kind ↔ DOKS) — directly relevant to Phase 8 work below.
- Risks, alternatives, sources/references — shared across both plans.

This plan covers **Phase 8 (DOKS public deploy), Phase 9 (Helm + CI + ArgoCD), Phase 10 (safety rails)**. The implementation units are lifted verbatim from the parent so this document is self-contained for execution. Anything not lifted (threat model, scope boundaries, key decisions) lives in the parent and is referenced by section anchor.

A separate plan covers the **landing-page UX redesign** ([`2026-05-05-002-feat-landing-page-redesign-plan.md`](2026-05-05-002-feat-landing-page-redesign-plan.md), forthcoming) — replacing the throwaway vanilla-TS landing from Phase 7.4 with a Remix-based UI matching the wireframes in `OpenVoid Wireframes.html`. The two plans intersect at one place: the Helm chart's `landing.image` value (Phase 9.1 in this plan) — see [Coordination with the Landing Page Redesign Plan](#coordination-with-the-landing-page-redesign-plan) below.

## Goal

Take v1 from "demoable on a developer laptop" (Phase 7) to "operationally responsible on a real public cloud":

- **Phase 8** — promote the kind architecture to DOKS at real public URLs (ingress-nginx LoadBalancer, cloudflared Tunnel, wildcard DNS, landing page on `app.<domain>`). **Fourth magic moment.**
- **Phase 9** — collapse every Phase 3–8 raw manifest and hard-coded constant into a single Helm chart with values per cluster; minimum-viable CI on every PR; ArgoCD reconciles changes into DOKS.
- **Phase 10** — implement the threat-model controls in the parent plan: NetworkPolicy egress allowlist, tightened `opencode.json`, `activeDeadlineSeconds=4h` failsafe documentation.

After Phase 10 lands, v1's milestone success criterion (R1) is fully met on both kind and DOKS.

## What's NOT in this plan

- **Landing page UI rewrite** — moved to the companion plan (`2026-05-05-002-…landing-page-redesign-plan.md`). Phase 9.1's `landing/` chart templates work for either the throwaway image or the Remix replacement; only the `landing.image` value changes.
- **Authentication / multi-user** — explicitly v1.5+. The deployment is single-operator; the cloudflared hostname is treated as private team knowledge. See parent plan's "Threat Model" section.
- **v1.5 features** — activity-aware idle reconciler, microVM/Firecracker isolation, persistent workspace (PVC), per-session GitHub App tokens, OpenShift implementation. See parent plan's "Scope Boundaries."
- **End-to-end CI gate** — Phase 9.4 ships path-filtered lint/typecheck/test/freshness/helm-lint only. Kind-cluster e2e gating is v1.5+.

## Requirements Trace

(Filtered from the parent plan to those still open at the start of Phase 8.)

- **R1 (milestone, DOKS leg).** Public DOKS deploy at real URLs is delivered by Phase 8.3; ArgoCD reconciliation in Phase 9.5 makes values-only changes promote without intervention.
- **R3 (per-service CI scoping).** Phase 9.4.
- **R5 (drift bounded by integration tests).** Phase 5's integration tests are reused unchanged against DOKS during Phase 8 demos.

R2, R4 are already satisfied (R2 by the TypeSpec contract from Phase 3, R4 retired in rev 4 — see parent).

## Threat Model & Scope Boundaries

Both inherited verbatim from the parent plan. The following Phase 8–10 controls implement them:

- Network isolation (default-deny NetworkPolicy + egress allowlist) → **Phase 10.1**.
- Tightened `opencode.json` (deny `/etc/git*`, deny webfetch to `*.github.com`, restrict bash) → **Phase 10.2**.
- `activeDeadlineSeconds = 4h` failsafe (already wired in code from Phase 4; documented + chart-parameterized) → **Phase 10.3**.
- CORS allowlist on the Session API scoped to landing-page hostname (already wired in code from Phase 7; chart values graduate it) → **Phase 9.1**.
- LLM provider auth as `opencode-auth` Secret on agent main only (already wired in code from Phase 6; chart references the Secret) → **Phase 9.1**.
- ingress-nginx Authorization injection at edge (already wired in code from Phase 7; chart references the Secret) → **Phase 9.1**.

See parent plan, "Threat Model (v1 Posture)" section.

## Cross-Platform Parity Matrix

The kind ↔ DOKS parity matrix in the parent plan is directly load-bearing for Phase 8 work. Read it before starting Phase 8 — every cluster-specific value in the matrix has a Helm-value home in Phase 9. **Implementer rule:** every Helm value with cluster-specific behavior MUST appear in both `infra/helm/values/local.yaml` and `infra/helm/values/dev.yaml`.

See parent plan, "Cross-Platform Parity Matrix (kind vs DOKS)" section.

## Key Technical Decisions Carried Forward

The following decisions from the parent plan directly shape Phase 8–10:

- **Routing is a Helm-level abstraction, not an application-level one** (`routing.mode: cloudflared` is the v1 default; `openshift-route` and `ingress` are reserved values for v1.5).
- **One namespace per logical concern** (`openvoid-system` for Session API + landing + cloudflared; `openvoid-sessions` for per-session pods).
- **Cloudflare Tunnel over Ingress for v1 DOKS** (zero LoadBalancer cost beyond the one ingress-nginx LB; one cloudflared Deployment routes the landing page, Session API, and per-session URLs through a single wildcard CNAME).
- **Three out-of-band Secrets stay out-of-band in Phase 9** (`git-creds`, `opencode-auth`, `cloudflared-token`) — real third-party credentials that the chart cannot auto-generate. Only `OPENCODE_SERVER_PASSWORD` graduates to chart-templated.
- **Default-deny NetworkPolicy on `openvoid-sessions`**, gated by `networkPolicies.enabled` chart value (`false` on kind, `true` on DOKS).
- **Pod-level failsafe: `activeDeadlineSeconds = 14400` (4h).**

See parent plan, "Key Technical Decisions" section for full rationale and superseded decisions.

## Coordination with the Landing Page Redesign Plan

The companion plan ([`2026-05-05-002-feat-landing-page-redesign-plan.md`](2026-05-05-002-feat-landing-page-redesign-plan.md)) replaces `services/landing/` (vanilla-TS + Vite + nginx) with a Remix-based UI. Both plans can ship in any order; the integration point is one Helm value:

```yaml
# infra/helm/values/dev.yaml (from Phase 9.1 of this plan)
landing:
  image:
    repository: ghcr.io/openvoid/landing
    tag: <sha>            # whichever image is current — vanilla-TS or Remix
  host: app.<domain>
```

**Operational consequences:**

- **If this plan ships first:** Phase 8 demos the throwaway vanilla-TS landing on DOKS. Phase 9 templates the chart against that image. The redesign plan later swaps `landing.image.tag` to the Remix image; ArgoCD rolls the new pod.
- **If the redesign ships first:** Phase 8 demos the Remix landing on DOKS from day one. The chart templates in Phase 9.1 work unchanged.
- **No duplication of work** between the two plans. The redesign plan owns `services/landing/` source code, build, tests; this plan owns chart templates, ingress wiring, env-var contract.

The redesign keeps the same env-var / build-arg contract Phase 7.4 established (`VITE_OPENVOID_API_URL` becomes whatever Remix's equivalent is — likely a runtime config-from-env pattern instead). The Helm chart treats the landing as an opaque image with a host value.

## Implementation Units

The following sections are lifted verbatim from the parent plan. Track checkbox progress here; the parent plan keeps its checkboxes for historical reference.

---

### Phase 8: Public deploy on DOKS — ingress-nginx + cloudflared + landing page (Slice 8 — rev 6)

**Demo checkpoint at end of phase:** The same browser flow Phase 7 proved on kind now runs on DOKS at real public URLs. An operator visits `https://app.<domain>` (a real Cloudflare-fronted hostname they control), clicks "Create new app", and sees the agent UI + live preview at `https://<sid>.{agent,preview}.<domain>` — no port-forward, no kubectl, no IP addresses. The architecture is the same as Phase 7 (per-session Service + Ingress with edge auth-injection, landing page served by nginx) — the only differences are: (a) ingress-nginx is exposed via a DigitalOcean LoadBalancer instead of host-port mappings, (b) a cloudflared Tunnel + wildcard CNAME at Cloudflare DNS routes `*.<domain>` to that LoadBalancer, (c) `VITE_OPENVOID_API_URL` is built into the landing page image at `https://api.<domain>`.

This is the **fourth "magic moment"** — the first time openvoid runs publicly on the open internet. Everything from this point on (Helm consolidation, GitOps reconciliation, safety rails) is about taking that public deployment from "demoable" to "operationally responsible."

> Rev 6: this phase is new. It promotes the kind-only Phase 7 architecture to a real DOKS public deployment. The work was originally bundled into Phase 7 (rev 6 first draft), then split out per the user's "Phase 7 is purely for local" decision. The cloudflared piece (rev-5 Unit 9.4) lives here. **All manifests in Phase 8 are raw `infra/remote/*.yaml` files** — Phase 9 collapses both kind raw YAML (Phase 7) and DOKS raw YAML (Phase 8) into one Helm chart.

- [ ] **Unit 8.1: Install ingress-nginx on DOKS (LoadBalancer)**

**Goal:** DOKS has a working ingress-nginx controller exposed as a `LoadBalancer` Service, with `--allow-snippet-annotations=true` set. DigitalOcean provisions a real LB and gives it an external IP; that IP is the cloudflared Tunnel's origin (Unit 8.2).

**Requirements:** R1 (DOKS public-access path); rev-6 routing decision.

**Dependencies:** Phase 1 (DOKS cluster exists); Phase 7 architecturally proven on kind (Unit 7.1's pattern is the template — same chart, different values).

**Files:**
- Create: `infra/remote/ingress-nginx-values.yaml` — DOKS values: `controller.service.type: LoadBalancer`, `controller.allowSnippetAnnotations: true`, `controller.config.use-forwarded-headers: "true"` (so the cloudflared X-Forwarded-* headers reach the per-session Ingress logic), `controller.config.annotations-risk-level: Critical` (carry forward from Phase 7's `infra/local/ingress-nginx-values.yaml` — required to actually honor `configuration-snippet`).
- Modify: `infra/remote/README.md` — DOKS install steps for ingress-nginx (one-time `helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace -f infra/remote/ingress-nginx-values.yaml`); document the LoadBalancer cost (~$10/mo while running) and that `infra/remote/doks-destroy.sh` tears it down.

**Approach:**
- DOKS provisions a DigitalOcean LoadBalancer (~$10/mo) when ingress-nginx requests one. The external IP becomes the only public-facing endpoint of the cluster — every other URL goes through cloudflared (Unit 8.2) and lands at this LB.
- `use-forwarded-headers: "true"` is required because cloudflared sets `X-Forwarded-For` / `X-Forwarded-Proto`. Without this, ingress-nginx ignores them and the per-session Ingress sees the Tunnel's IP instead of the user's IP.
- The same `--allow-snippet-annotations=true` + `annotations-risk-level: Critical` trade-off from Phase 7's Unit 7.1 applies — the threat model is unchanged on DOKS.

**Patterns to follow:**
- ingress-nginx Helm values reference (chart version pinned, matching Phase 7's pin at 4.15.1).
- DigitalOcean Kubernetes LoadBalancer docs: https://docs.digitalocean.com/products/kubernetes/how-to/configure-load-balancers/

**Test scenarios:**
- Happy path: after the install, `kubectl get svc -n ingress-nginx ingress-nginx-controller` shows a LoadBalancer with an external IP; `curl https://<external-ip>/` returns 404 from the default backend (TLS will be handled by cloudflared in Unit 8.2; for now use `--insecure` since ingress-nginx ships with a self-signed cert).
- Edge case: `kubectl get configmap -n ingress-nginx ingress-nginx-controller -o yaml | grep allow-snippet-annotations` returns `"true"` and `use-forwarded-headers` returns `"true"`.

**Verification:**
- An LB is provisioned in the DigitalOcean console; the IP is reachable from the public internet.

---

- [ ] **Unit 8.2: cloudflared Tunnel + Cloudflare DNS wildcard CNAME**

**Goal:** A single cloudflared Deployment in `openvoid-system` runs a Cloudflare Tunnel with a wildcard ingress rule `*.<domain>` → ingress-nginx LoadBalancer Service. A wildcard CNAME at Cloudflare DNS (`*.<domain>` → `<tunnel-id>.cfargotunnel.com`) routes all session subdomains, the landing-page hostname, and the Session API hostname through the Tunnel. Combined with Phase 7's per-session Ingress logic, every session gets a public URL on DOKS without per-session cloudflared config edits.

**Requirements:** R1 (DOKS public-access path); rev-6 routing decision.

**Dependencies:** Unit 8.1 (ingress-nginx + LoadBalancer Service exist on DOKS).

**Files:**
- Create: `infra/remote/cloudflared.yaml` — Deployment + ConfigMap (Tunnel config). Tunnel token Secret stays out-of-band (real Cloudflare account credential).
- Create: `infra/remote/cloudflared-config.example.yaml` — example Tunnel config: one ingress rule `hostname: "*.<domain>"` → `service: https://ingress-nginx-controller.ingress-nginx.svc.cluster.local:443`, with `originRequest.noTLSVerify: true` (ingress-nginx self-signed cert).
- Modify: `infra/remote/README.md` — Cloudflare setup steps: create a Tunnel via dashboard, copy the token into `kubectl create secret generic cloudflared-token --from-literal=token=<token> -n openvoid-system`, create the wildcard CNAME at Cloudflare DNS pointing at `<tunnel-id>.cfargotunnel.com`, apply `cloudflared.yaml`.
- Modify: `.gitignore` — exclude any local copy of `cloudflared-token-secret.yaml` (mirroring the `git-creds-secret.yaml` pattern).

**Approach:**
- One Tunnel, one ingress rule, wildcard hostname → ingress-nginx in-cluster Service. cloudflared respects the `Host` header from the client; ingress-nginx then matches the per-session Ingress rule by host (logic from Phase 7 Unit 7.2 — unchanged on DOKS).
- Tunnel token stays in a Secret (out-of-band — same posture as `git-creds` and `opencode-auth`). Phase 9 documents but does not template the token (real Cloudflare account credential, can't be auto-generated).
- Cost: $0 for the Tunnel + Cloudflare DNS (free tier). Adds to the DOKS LB cost from Unit 8.1.
- Optional simplification for personal demos: Cloudflare Quick Tunnel (`*.trycloudflare.com`) — URLs change per Tunnel restart but no DNS setup needed. Documented as a fallback path; the wildcard at a real domain is the supported v1 path.

**Patterns to follow:**
- Cloudflare Tunnel + Kubernetes guide: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deployment-guides/kubernetes/
- Tunnel `originRequest.noTLSVerify: true` for the in-cluster ingress-nginx Service (self-signed cert).

**Test scenarios:**
- Happy path: `kubectl get pods -n openvoid-system -l app=cloudflared` shows the Tunnel pod Running; `kubectl logs` shows successful Tunnel registration with Cloudflare's edge.
- Happy path: `dig +short *.<domain>` resolves to a Cloudflare IP; `curl https://random-host.<domain>/` reaches ingress-nginx and returns its 404 default backend (proves the wildcard CNAME + Tunnel chain works).
- Edge case: cloudflared pod restart; Tunnel reconnects within seconds; a session created before the restart remains reachable.
- Edge case: Tunnel token rotated; `kubectl rollout restart deployment/cloudflared -n openvoid-system` picks up the new token.

**Verification:**
- A test session's `<sid>.agent.<domain>` URL loads OpenCode's web UI in a browser, with no password dialog (the Phase 7 edge auth-injection logic carries over unchanged through cloudflared → ingress-nginx).

---

- [ ] **Unit 8.3: Landing page + Session API Ingress on DOKS, image build for DOKS**

**Goal:** The landing page image is rebuilt for DOKS (with the right API URL baked in) and pushed to GHCR. A DOKS-specific manifest applies the landing page's Deployment + Service + Ingress at `app.<domain>`, plus an Ingress for the Session API at `api.<domain>`. The Session API Deployment's env block is updated for DOKS (`OPENVOID_DOMAIN_BASE=<domain>`, `OPENVOID_URL_SCHEME=https`, `OPENVOID_LANDING_ORIGIN=https://app.<domain>`). End-to-end: a browser at `https://app.<domain>` produces a session whose URLs work over the public internet.

**Requirements:** R1 (DOKS public-access path); rev-6 UI strategy.

**Dependencies:** Unit 8.2 (cloudflared Tunnel + wildcard DNS resolve); a landing-page image exists (Phase 7.4 throwaway, OR the Remix replacement from the companion plan — either works at this point in time; the chart in Phase 9.1 owns the integration).

**Files:**
- Create: `infra/remote/landing.yaml` — DOKS: landing page Deployment (image tag `ghcr.io/openvoid/landing:<sha>`) + Service + Ingress at `app.<domain>`.
- Create: `infra/remote/session-api-ingress.yaml` — DOKS: Ingress for the Session API at `api.<domain>` (the existing Service in `infra/local/session-api.yaml` is reused; only the Ingress is new for DOKS).
- Modify: `infra/local/session-api.yaml` — note in a comment that this file is kind-only; DOKS uses the Helm chart in Phase 9 (or `infra/remote/session-api.yaml` if a temporary DOKS deploy is needed before Phase 9 lands). For Phase 8, the implementer can copy this file's Deployment / Service / RBAC into `infra/remote/session-api.yaml` and apply it on DOKS, with the env block adjusted for DOKS values.
- Create: `infra/remote/session-api.yaml` — DOKS Deployment + Service + RBAC for the Session API, with env block carrying DOKS values: `OPENVOID_DOMAIN_BASE: <domain>`, `OPENVOID_URL_SCHEME: https`, `OPENVOID_LANDING_ORIGIN: https://app.<domain>`. Image is `ghcr.io/openvoid/session-api:<sha>`.
- Create: `scripts/remote-deploy.sh` — one-shot script that builds + pushes the session-api and landing images to GHCR, applies all `infra/remote/*.yaml`, and prints the demo URL. Disposable — Phase 9 replaces it with `helm install`.
- Modify: `infra/remote/README.md` — sequence the bring-up: (1) ingress-nginx (Unit 8.1), (2) cloudflared (Unit 8.2), (3) Secrets (`git-creds`, `opencode-server-password`, `opencode-auth`), (4) `scripts/remote-deploy.sh`, (5) demo at `https://app.<domain>`.

**Approach:**
- The landing-page image source is rebuilt with the DOKS API URL baked in. Whichever landing implementation is current (Phase 7.4 vanilla-TS or the Remix replacement) is the source — the build-arg / env-var contract is the same.
- The `services/session-api/` image is unchanged from Phase 6 — only its env block differs per cluster.
- The Session API runs at `replicas: 1` on DOKS (single pod, no presence registry to coordinate — rev-6 dropped that need). The DOKS Deployment is reachable internally at `session-api.openvoid-system.svc.cluster.local:4000`; the Ingress at `api.<domain>` exposes it publicly.
- DOKS-side Secrets (`git-creds`, `opencode-server-password`, `opencode-auth`) are applied the same way as on kind — out-of-band `kubectl apply`. Same example files from Phase 4 / 6.2 are reused; no DOKS-specific shape.
- Phase 9 absorbs every file in `infra/remote/*.yaml` into `infra/helm/openvoid/templates/` — Phase 8's raw manifests are deliberately disposable.

**Patterns to follow:**
- Phase 3's `infra/local/session-api.yaml` shape — DOKS gets the same shape with different image tags + env vars.
- Phase 7.4's `services/landing/Dockerfile` build-arg pattern (or whatever the Remix replacement establishes — see companion plan).

**Test scenarios:**
- Happy path: after `scripts/remote-deploy.sh`, `https://app.<domain>` loads the landing page; `https://api.<domain>/sessions` POST works (CORS allows the landing-page origin).
- Happy path: a session created via the landing page produces working URLs at `https://<sid>.{agent,preview}.<domain>`. Agent UI loads with no password dialog. Preview loads with no auth.
- Happy path (end-to-end): on `https://app.<domain>`, click "Create new app", prompt the agent, see the preview update, click Stop, see the `feat/<sid>` branch on GitHub. **DOKS magic moment.**
- Edge case: `OPENVOID_LANDING_ORIGIN` mis-set on the Session API; the browser's preflight OPTIONS fails with a CORS error; the landing page surfaces "API unreachable."
- Edge case: cloudflared Tunnel down; the landing page surfaces "API unreachable" (different error message — connection refused); the operator restarts cloudflared and the page recovers.

**Verification:**
- The full DOKS demo runs cleanly. Phase 9 will replace `scripts/remote-deploy.sh` with `helm install`, but the user-facing behaviour is identical.

---

### Phase 9: Helm chart consolidates everything + CI + ArgoCD (Slice 9 — rev 6)

**Demo checkpoint at end of phase:** `helm install openvoid infra/helm/openvoid -f infra/helm/values/local.yaml` against kind installs **everything** authored in Phases 3–7 as one chart: Session API (replacing Phase 3's raw `infra/local/session-api.yaml`), the auto-generated `OPENCODE_SERVER_PASSWORD` Secret, the ingress-nginx values reference + per-session-routing parameters from Phase 7, the landing-page Deployment + Service + Ingress (replacing the Phase 7 raw manifests), and (DOKS only) the cloudflared Deployment + ConfigMap. CI runs lint + typecheck + test + freshness + helm-lint on every PR. ArgoCD reconciles the chart against `infra/helm/values/dev.yaml` for DOKS, so a values-only PR merge to `main` rolls the cluster within ~3 min.

> Rev 6: this phase consolidates everything. Original (rev-5) Phase 7 was just the chart skeleton; rev 6 absorbs three more concerns into the same phase — the Phase 7 ingress + landing-page templates, plus rev-5 Unit 9.6 (CI) and Unit 9.7 (ArgoCD). Two Secrets still stay out-of-band: `git-creds` (real PAT) and `opencode-auth` (real LLM key). The Cloudflare Tunnel token is a third out-of-band Secret. Only `OPENCODE_SERVER_PASSWORD` (a string the platform defines) graduates into chart-templated.

> Rev 5: phase position is Helm-after-OpenCode (carried forward in rev 6). Helm is the **consolidation phase** — every constant in `client.ts` and every out-of-band Secret applied in Phases 4–7 graduates to chart values or chart templates here. The Session API's `infra/local/session-api.yaml` (Phase 3) and Phase 7's `infra/local/landing.yaml` + `infra/remote/landing.yaml` are replaced by the chart at the end of this phase.

> Rev 4: this phase replaces the original "Session Operator skeleton" phase. There is **no operator** to author.

- [ ] **Unit 9.1: Helm chart skeleton + Session API + OpenCode Secret + finalizer values + Phase-7 (kind) + Phase-8 (DOKS) ingress / landing-page / cloudflared templates**

**Goal:** `infra/helm/openvoid/` is a Helm v3 chart that templates: the namespaces, the Session API's ServiceAccount/RBAC/Deployment/Service, the cluster-wide `OPENCODE_SERVER_PASSWORD` Secret (auto-generated default), and the values that parameterize per-session Pods (image, deadlines, finalizer config). The chart's values cover both kind (`infra/helm/values/local.yaml`) and DOKS (`infra/helm/values/dev.yaml`) defaults.

**Requirements:** R3 (CI scoping is enabled by Helm-rendering); supports R1 deployment story on both clusters; rev-3 OpenShift readiness (the seam for `routing.mode` lands here even though the routing template itself is empty in this phase).

**Dependencies:** Phase 8 complete.

**Files:**
- Create: `infra/helm/openvoid/Chart.yaml` (apiVersion v2, version 0.1.0).
- Create: `infra/helm/openvoid/values.yaml` — defaults (Session API + chart-wide). Values: `namespace.{system,sessions}`, `sessionApi.{image.repository,image.tag,replicas}`, `session.{image,activeDeadlineSeconds,workspace.type,workspace.sizeLimit,terminationGracePeriodSeconds,gitFinalizer.image}`, `session.opencode.{provider,model}` (LLM provider/model selection — default likely `openrouter` + a sonnet-class model, per Unit 6.0's spike), `session.allowedLLMHosts` (list of hostnames the agent's NetworkPolicy egress will allow; default to the configured provider's host, e.g., `["openrouter.ai"]` or `["api.anthropic.com"]`; consumed by Phase 10's NetworkPolicy template), `session.resources.{requests,limits}` (graduates the per-session resource budget constants from Phase 7 follow-up — 1 vCPU / 1 GiB / 10 GiB workspace), `gitCreds.secretName` (referenced; Secret stays out-of-band), `opencodeAuth.secretName` (referenced; Secret stays out-of-band — same posture as `gitCreds`), `opencodePassword.{secretName,autoGenerate,value}` (defaults: auto-generate), `networkPolicies.enabled` (Phase 10 toggles), `routing.mode` (default `cloudflared`; reserved values `openshift-route`, `ingress` per rev 3).
- Create: `infra/helm/openvoid/templates/namespaces.yaml`.
- Create: `infra/helm/openvoid/templates/session-api/{serviceaccount,role,rolebinding,deployment,service}.yaml` — port `infra/local/session-api.yaml` into Helm templates.
- Create: `infra/helm/openvoid/templates/secrets/opencode-server-password.yaml` — chart-managed Secret in `openvoid-system`, auto-generated password by default (`{{ randAlphaNum 32 }}` with a `lookup` guard so re-installs don't rotate). Replaces the out-of-band Secret from Phase 6 — at install time, the implementer's hand-applied `infra/local/opencode-password-secret.yaml` is deleted and the chart-managed one takes over.
- Create: `infra/helm/openvoid/templates/_helpers.tpl` — common labels, fully-qualified naming.
- Create: `infra/helm/openvoid/templates/routing/.gitkeep` — empty seam directory; reserved for v1.5 `openshift-route` / `ingress` modes.
- Create: `infra/helm/values/local.yaml` (kind defaults).
- Create: `infra/helm/values/dev.yaml` (DOKS defaults — image=`ghcr.io/openvoid/session-api:<sha>`, networkPolicies enabled).
- Create: `infra/helm/openvoid/README.md` — values reference, chart usage notes, link to the Cross-Platform Parity Matrix in the parent plan.
- **Phase-7/8 absorbed templates:**
  - Create: `infra/helm/openvoid/templates/landing/{deployment.yaml,service.yaml,ingress.yaml}` — landing-page templates that replace `infra/local/landing.yaml` and `infra/remote/landing.yaml`. Image, replicas, and host (`landing.host` value, e.g., `app.<domain>` or `app.127.0.0.1.nip.io`) are values-driven. **Image-agnostic** — works for either the Phase 7.4 vanilla-TS landing or the Remix replacement (companion plan).
  - Create: `infra/helm/openvoid/templates/session-api/ingress.yaml` — Session API's own Ingress (not per-session — this is the API's stable hostname, e.g., `api.<domain>`). Replaces the raw manifest from Phase 7.4.
  - Create: `infra/helm/openvoid/templates/cloudflared/{deployment.yaml,configmap.yaml}` — gated by `cloudflared.enabled` (DOKS only). Tunnel token Secret stays out-of-band (real Cloudflare credential, can't be auto-generated). Replaces the raw `infra/remote/cloudflared.yaml`.
  - Modify: `infra/helm/openvoid/values.yaml` — add `landing.{image.repository,image.tag,replicas,host}`, `sessionApi.host`, `cloudflared.{enabled,tunnelTokenSecretRef}`, `domainBase`, `urlScheme`. The Session API Deployment's env block populates `OPENVOID_DOMAIN_BASE` and `OPENVOID_URL_SCHEME` from these values.
  - Modify: `infra/helm/values/local.yaml` — `cloudflared.enabled: false`, `domainBase: 127.0.0.1.nip.io`, `urlScheme: http`, landing/api hosts under `*.127.0.0.1.nip.io`.
  - Modify: `infra/helm/values/dev.yaml` — `cloudflared.enabled: true`, `domainBase: <domain>`, `urlScheme: https`, landing/api hosts under `*.<domain>`.

**Approach:**
- Author by porting `infra/local/session-api.yaml` (Phase 3) into templates one resource at a time. The chart's first install on kind should produce a diff-clean equivalent of Phase 3's manifest plus the new Secret template.
- Per-session Pod manifests are *not* in the chart — pods are created at runtime by the Session API. The chart provides the **values** the Session API reads to configure those pods (image, activeDeadlineSeconds, workspace size, finalizer grace period, resource budget, etc.).
- Phase 3's `infra/local/session-api.yaml` is **deleted** at the end of this phase (replaced by the chart). The implementer's hand-applied `infra/local/opencode-password-secret.yaml` is also deleted (replaced by the chart's templated Secret). `infra/local/git-creds-secret.yaml` and `infra/local/opencode-auth-secret.yaml` stay — both hold real third-party credentials that openvoid can't auto-generate (a GitHub PAT and an LLM provider API key respectively).
- Tilt switches from `k8s_yaml('infra/local/session-api.yaml')` to a `helm()` extension call.

**Patterns to follow:**
- Bitnami chart conventions for `_helpers.tpl` (named templates, fully qualified names).
- Helm's `lookup` function pattern for "auto-generate once, persist on re-install" Secret idiom (avoids password rotation churn).
- `docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md` — the chart contains *only* persistent infra (Session API + Secret + landing + cloudflared), not session pods.

**Test scenarios:**
- Happy path: `helm template infra/helm/openvoid -f infra/helm/values/local.yaml` produces valid YAML; output includes the namespaces, ServiceAccount, Role, RoleBinding, Deployment, Service, and OPENCODE_SERVER_PASSWORD Secret.
- Happy path: `helm install openvoid infra/helm/openvoid -f infra/helm/values/local.yaml` against `kind-openvoid-local` installs cleanly; `helm list -A` shows the release; Phase 6's clone+modify+push flow continues to work, now driven by the chart-managed Secret.
- Happy path: `helm uninstall openvoid && helm install openvoid …` regenerates a fresh password (no `lookup` cache) — documented as expected during dev; `helm upgrade` preserves the existing password (`lookup` returns the existing value).
- Edge case: `helm upgrade` with an image tag bump rolls the Deployment without disrupting in-flight pods (zero-downtime check).
- Edge case: `helm template ... --set routing.mode=openshift-route` rendering doesn't error even though `templates/routing/openshift-route.yaml` doesn't exist in v1 (the empty-seam validation).

**Verification:**
- `helm list -A` shows the `openvoid` release in `openvoid-system`.
- `kubectl get all -n openvoid-system` includes the Session API Deployment + Service + the OpenCode password Secret + the landing page Deployment + Service.
- Phases 5, 6, and 7 demo flows still work end-to-end (kubectl-exec lifecycle, agent-driven lifecycle producing `feat/<sid>` branches on GitHub, and the landing-page → URLs → preview flow).

---

- [ ] **Unit 9.2: Session API reads chart values for per-session Pod parameters**

**Goal:** Hard-coded constants in `services/session-api/src/k8s/client.ts` (image, `activeDeadlineSeconds`, workspace size limit, finalizer image, finalizer grace period, per-session resource budget, etc.) graduate to environment variables sourced from the chart's `session.*` values block. The chart and the Session API agree on a small env-var contract; this is the pivot's analog of "CRD spec is intentionally lean."

**Requirements:** R1; Key Technical Decision "Pod-spec is intentionally lean."

**Dependencies:** Unit 9.1.

**Files:**
- Modify: `services/session-api/src/k8s/client.ts` — read `process.env.OPENVOID_STUB_IMAGE` (already exists), `OPENVOID_SESSION_ACTIVE_DEADLINE_SECONDS`, `OPENVOID_SESSION_WORKSPACE_SIZE_LIMIT`, `OPENVOID_GIT_IMAGE`, `OPENVOID_GIT_FINALIZER_IMAGE`, `OPENVOID_SESSION_TERMINATION_GRACE_PERIOD_SECONDS`, `OPENVOID_OPENCODE_PASSWORD_SECRET_NAME`, `OPENVOID_OPENCODE_AUTH_SECRET_NAME`, `OPENVOID_OPENCODE_PROVIDER` (`anthropic` / `openai` / `openrouter`), `OPENVOID_OPENCODE_MODEL`, `OPENVOID_SESSION_CPU_REQUEST`, `OPENVOID_SESSION_CPU_LIMIT`, `OPENVOID_SESSION_MEMORY_REQUEST`, `OPENVOID_SESSION_MEMORY_LIMIT`. Defaults preserved as fallbacks.
- Modify: `infra/helm/openvoid/templates/session-api/deployment.yaml` — `env:` block populates the variables from `.Values.session.*`, `.Values.session.opencode.{provider,model}`, `.Values.session.resources.*`, `.Values.opencodePassword.secretName`, and `.Values.opencodeAuth.secretName`.
- Modify: `infra/helm/openvoid/values.yaml` — defaults for the values listed above.
- Modify: `services/session-api/test/routes.sessions.test.ts` (and `test/k8s/*.test.ts`) — env-var-driven defaults are exercised in tests.

**Approach:**
- The Session API stays the only place that knows how to assemble a Pod spec; the chart only supplies the parameters. This keeps the per-session pod creation logic colocated with the API's HTTP handlers and test suite.
- Reading env vars at boot (not per-request) is fine for v1; chart upgrades restart the Deployment, picking up new values.
- Behaviour is unchanged from Phase 6/7 — only configurability gains. Constants graduate to env vars; out-of-band Secret reference graduates to chart-templated.

**Patterns to follow:**
- The Phase 3 pattern of `process.env.OPENVOID_STUB_IMAGE ?? "nginx:alpine"` — extend to the new variables.

**Test scenarios:**
- Happy path (unit): with env vars unset, defaults apply; manifest carries the documented defaults (including `terminationGracePeriodSeconds: 180`, `git-finalizer` image `alpine/git:2.45.2`, OpenCode image, the configured `opencodePassword.secretName`, and the 1 vCPU / 1 GiB session resource budget).
- Happy path (unit): with env vars set to overrides, manifest carries the override values.
- Edge case (unit): malformed numeric env var (e.g., `OPENVOID_SESSION_ACTIVE_DEADLINE_SECONDS=not-a-number`) — the Session API rejects loudly at boot rather than silently defaulting (fail-fast).

**Verification:**
- `kubectl exec -n openvoid-system <session-api-pod> -- env | grep OPENVOID_` shows the variables populated from the chart.
- Demo: `helm upgrade` with `--set session.activeDeadlineSeconds=600`; create a session; `kubectl get pod -n openvoid-sessions <pod> -o jsonpath='{.spec.activeDeadlineSeconds}'` returns 600.
- Demo: `helm upgrade` with `--set session.terminationGracePeriodSeconds=300`; create a session; the manifest carries the override.

---

- [ ] **Unit 9.3: Tilt becomes Helm-aware**

**Goal:** The root `Tiltfile` switches from `k8s_yaml('infra/local/session-api.yaml')` to a Helm-driven flow. The dev experience stays identical (single `tilt up`, hot-reload still works on `services/session-api/src`), but the chart is now the source of truth.

**Requirements:** Local-dev parity (kind + Tilt as primary daily loop); single-bootstrap simplicity.

**Dependencies:** Unit 9.1, Unit 9.2.

**Files:**
- Modify: `Tiltfile` — replace `k8s_yaml('infra/local/session-api.yaml')` and `k8s_yaml('infra/local/landing.yaml')` with `helm('infra/helm/openvoid', name='openvoid', namespace='openvoid-system', values=['infra/helm/values/local.yaml'])`. Keep the existing `docker_build` for `services/session-api` and the landing image. Keep the kind-context guard.
- Delete: `infra/local/session-api.yaml`, `infra/local/landing.yaml` (superseded by the chart).
- Delete: any locally-applied `infra/local/opencode-password-secret.yaml` (superseded by the chart-managed Secret); note in the README that the example file remains for reference but is no longer the live install path.
- Modify: `README.md` — refresh the "Local dev with Tilt" section to mention Helm rendering and the chart location.

**Approach:**
- Tilt's `helm()` extension renders the chart and feeds the resulting manifests into Tilt's reconciliation. The image-name match between `docker_build` and the chart's templated image makes live-update continue to work.
- The kind-context guard from Phase 3 stays in place.

**Patterns to follow:**
- Tilt docs, "Helm" extension recipe.

**Test scenarios:**
- Test expectation: none for the Tiltfile itself (config). Verified by demo.

**Verification:**
- `tilt alpha tiltfile-result` parses cleanly.
- `tilt up` against kind still produces a healthy `session-api` resource; editing `services/session-api/src/server.ts` still triggers a live update within ~5 s.
- Phases 3, 4, 5, 6, 7 demo flows continue to work end-to-end (including the landing page, agent UI, and live preview).

---

- [ ] **Unit 9.4: Minimum-viable CI**

**Goal:** Every PR runs the cheap, high-value checks. No kind cluster spinning, no e2e gate (deferred to v1.5).

**Requirements:** R3 (path-filtered per-workspace CI), generated-artifact freshness.

**Dependencies:** Unit 9.1 (chart exists for `helm-lint`); all other phases (TS code exists for lint/test/typecheck).

**Files:**
- Create: `.github/workflows/ci.yml`.

**Approach:**
- Single workflow with path-filtered jobs:
  - `ts-lint-typecheck`: triggered by changes under `services/`, `packages/`. Runs `pnpm turbo run lint typecheck` against affected workspaces.
  - `ts-test`: same trigger; runs `pnpm turbo run test`.
  - `freshness`: triggered by changes under `packages/protocol/`. Regenerates artifacts and `git diff --exit-code`.
  - `helm-lint`: triggered by changes under `infra/helm/`. Runs `helm lint` and `kubeconform` against rendered manifests.
- The Phase 7 landing page (and its Remix replacement, when it ships) is included via the `services/` path filter.
- Manual demo verification at the end of each phase substitutes for the gate during v1.

**Test scenarios:**
- Happy path: PR that doesn't break anything passes CI within ~3 min.
- Edge case: PR that edits TypeSpec without regenerating fails `freshness`.
- Edge case: PR that breaks Helm chart rendering fails `helm-lint`.

**Verification:**
- A trial PR exercises every job; failures produce useful error messages.

---

- [ ] **Unit 9.5: ArgoCD wiring for DOKS**

**Goal:** A single ArgoCD `Application` reconciles `infra/helm/openvoid` against the DOKS cluster from a tracked branch. Pushing a values change to that branch triggers a re-sync; pushing a chart-template change does the same. Local kind dev continues to use Tilt; ArgoCD is DOKS-only.

**Requirements:** Helm-driven trunk-based deploy via ArgoCD.

**Dependencies:** Unit 9.1 (chart includes everything that should be reconciled — Session API + landing page + cloudflared + Phase-7 routing).

**Files:**
- Create: `infra/argocd/openvoid-application.yaml` — `Application` CR in `argocd` namespace pointing at the chart in this repo on the `main` branch (or a `dev` branch if preferred).
- Create: `infra/argocd/README.md` — bootstrap recipe (install ArgoCD, register the Application, verify sync).
- Modify: `README.md` — add the DOKS deploy flow.

**Approach:**
- One Application, sync-policy automated, prune+self-heal **disabled** in v1 (auto-prune is enabled manually after the first release survives a manual prune review). Targets `infra/helm/openvoid` directory; values from `infra/helm/values/dev.yaml`.
- Bootstrap sequence: implementer installs ArgoCD on DOKS (one-time `helm install argocd argo/argo-cd ...`), applies the openvoid Application CR, and watches the sync status.

**Patterns to follow:**
- ArgoCD declarative-setup docs.

**Test scenarios:**
- Happy path: bumping `landing.image.tag` in `infra/helm/values/dev.yaml` and pushing to `main` causes ArgoCD to roll the landing-page Deployment within ~3 min.
- Edge case: a deliberate values typo (e.g., bad `routing.mode` value) fails the sync with a useful error in the ArgoCD UI; the previous good revision keeps running.

**Verification:**
- Demo on DOKS: an end-to-end deploy from a values-only PR merge to `main`.

---

### Phase 10: Safety rails — NetworkPolicy + opencode.json hardening + activeDeadlineSeconds (Slice 10 — rev 6)

**Demo checkpoint at end of phase:** The session pod's egress is locked down to GitHub HTTPS, the configured LLM provider, and DNS. `opencode.json` denies the agent's read of `/etc/git-creds`, denies webfetch to `*.github.com`, and restricts bash. A session that exceeds 4 hours of wall-clock is killed by the kubelet with a clean `Reason: DeadlineExceeded` event. The pod's threat-model surface from the v1 posture section is fully implemented.

> Rev 4: this phase replaces the original "Commit-on-Shutdown belt-and-braces" phase. The belt-and-braces (periodic auto-commit) is dropped — native sidecar SIGTERM trap is reliable enough for v1 (deferred to v1.5 if real users need it). Reframed around defense in depth: NetworkPolicy, opencode.json hardening, `activeDeadlineSeconds` failsafe.

- [ ] **Unit 10.1: Default-deny NetworkPolicy on `openvoid-sessions`**

**Goal:** Session pods can egress only to: the configured Git host (GitHub HTTPS:443), the configured LLM provider host(s) (driven by `session.allowedLLMHosts` from Phase 9's chart values — typically `openrouter.ai`, `api.anthropic.com`, or `api.openai.com` depending on which provider the platform operator chose), and DNS. They cannot reach the K8s API server, the cloud metadata service (169.254.169.254), or other namespaces.

**Requirements:** Threat Model — network isolation in v1.

**Dependencies:** Phase 9 complete (so the chart can template the policy).

**Files:**
- Create: `infra/helm/openvoid/templates/sessions/networkpolicy.yaml` — default-deny + explicit egress allowlist; gated on `.Values.networkPolicies.enabled`.
- Modify: `infra/helm/values/local.yaml` — `networkPolicies.enabled: false` (kind doesn't enforce by default; documenting only).
- Modify: `infra/helm/values/dev.yaml` — `networkPolicies.enabled: true`.

**Approach:**
- Three rules: (1) DNS to kube-system, (2) GitHub HTTPS:443 (allowlist by IP block from `whois`/Cloudflare's published ranges, or by FQDN if the cluster's CNI supports it), (3) configured LLM provider HTTPS:443 (one or more of `openrouter.ai`, `api.anthropic.com`, `api.openai.com` — chart value `session.allowedLLMHosts` is the source of truth; the template iterates over it so adding/removing providers is a one-line values change without touching the policy template).
- The K8s API server block is implicit: default-deny ingress + only-allowlisted egress means no `kubernetes.default.svc:443` reachability from session pods.
- Metadata service block: explicit deny rule for `169.254.169.254/32` for clouds that surface it (DOKS does).
- On kind, the policy renders but doesn't enforce; the implementer can verify the policy compiles and is well-formed but should not rely on kind to validate enforcement.

**Patterns to follow:**
- Calico/Cilium NetworkPolicy examples for FQDN-based allowlists.
- The compass research §4 reliability gotcha — NetworkPolicy must allow GitHub HTTPS:443 or the finalizer push will be silently blocked.

**Test scenarios:**
- Happy path: `helm template ... -f infra/helm/values/dev.yaml` produces a NetworkPolicy resource.
- Happy path: `helm template ... -f infra/helm/values/local.yaml` does **not** produce a NetworkPolicy resource (toggled off).
- Edge case: `kubectl apply` of the rendered NetworkPolicy on DOKS does not error (well-formed manifest).
- Integration (manual demo, DOKS): from inside a session pod, `curl https://kubernetes.default.svc` fails (blocked); `curl https://github.com` succeeds; `curl http://169.254.169.254/latest/meta-data/` fails.

**Verification:**
- Demo: on DOKS, exec into a session pod and prove (1) GitHub egress works (clone + push still succeed), (2) K8s API egress fails, (3) metadata service egress fails.

---

- [ ] **Unit 10.2: Tightened `opencode.json`**

**Goal:** The OpenCode permissions config in `infra/images/opencode/opencode.json` denies the agent reading `/etc/git*`, denies webfetch to `*.github.com`, and restricts bash to a curated allowlist. This is defense in depth alongside Unit 10.1 (NetworkPolicy) — even if NetworkPolicy is bypassed, the agent's tool surface is constrained.

**Requirements:** Threat Model — agent permissions; rev-2 PAT hardening decision.

**Dependencies:** Unit 6.1 (image with the placeholder permissive `opencode.json`); Unit 10.1 (NetworkPolicy is the parallel control).

**Files:**
- Modify: `infra/images/opencode/opencode.json` — full denylist per threat model.

**Approach:**
- Replace the Phase 6 placeholder permissive config with (the exact `auth.json` path on the deny list comes from Unit 6.0's spike — substitute the verified path):
  ```json
  {
    "$schema": "https://opencode.ai/config.json",
    "permission": {
      "bash": {
        "*": "ask",
        "git *": "allow",
        "npm *": "allow", "pnpm *": "allow", "node *": "allow",
        "cat /etc/*": "deny", "cat /var/run/secrets/*": "deny",
        "cat /var/opencode-data/opencode/auth.json": "deny",
        "rm -rf /*": "deny", "rm -rf /workspace/.git": "deny"
      },
      "edit": "allow",
      "read": {
        "*": "allow",
        "/etc/*": "deny",
        "/var/run/secrets/*": "deny",
        "/var/opencode-data/opencode/auth.json": "deny"
      },
      "webfetch": { "*": "allow", "*github.com*": "deny", "169.254.169.254*": "deny" },
      "external_directory": "deny"
    }
  }
  ```
- Rationale per rule:
  - `read` denylist prevents the agent from reading `/etc/git-credentials` and its own LLM `auth.json` (so prompt-injection can't trick the agent into echoing its provider key into chat or a webfetch).
  - `webfetch` denylist prevents exfiltration via GitHub API (push still works because git uses HTTPS protocol, not webfetch) and prevents metadata service access.
  - `bash` denylist closes the `cat` exfil path for both credential locations.
  - The tightening is meaningful even with NetworkPolicy in place (defense in depth — NetworkPolicy is enforced at the cluster but not on kind by default).
- The exact `auth.json` path is `/var/opencode-data/opencode/auth.json` (pinned by `XDG_DATA_HOME` in the Phase 6.1 Dockerfile).

**Patterns to follow:**
- The original Phase 6 (rev 2) / Phase 7 (rev 5) config decomposition — same content, just packaged as a "Phase 10 hardening" task instead of being co-located with the image build.

**Test scenarios:**
- Happy path (manual demo): start a session; from the agent (via `POST /session/<sid>/message`), ask it to `cat /etc/git-credentials` — request is denied.
- Happy path (manual demo): from the agent, ask it to read its own `auth.json` — request is denied.
- Happy path (manual demo): from the agent, ask it to fetch `https://api.github.com/users/octocat` — request is denied (webfetch to `*github.com*`).
- Edge case (manual demo): from the agent, ask it to run `git push` — succeeds (allowed in `bash` allowlist).
- Edge case (manual demo): from the agent, ask it to `rm -rf /workspace` — denied.

**Verification:**
- The Phase 5 demo flow still works (clone, edit, push) and the Phase 6 agent demo still works (prompt, edit, push) — none of the denylists block the legitimate clone/push path.

---

- [ ] **Unit 10.3: `activeDeadlineSeconds` documentation + chart parameterization**

**Goal:** The `activeDeadlineSeconds = 14400` (4 h) value introduced in Phase 4 is documented as the kubelet-level failsafe in the chart README, and the value is exposed as a Helm value (`session.activeDeadlineSeconds`). Behavior on deadline trip is documented: kubelet kills the pod with `DeadlineExceeded`; the SIGTERM cascade still runs within the deadline window so the finalizer gets its push attempt.

**Requirements:** Pod-level failsafe decision in Key Technical Decisions.

**Dependencies:** Unit 4.3 (where the value first lands), Unit 9.2 (where the chart values graduated from constants).

**Files:**
- Modify: `infra/helm/openvoid/values.yaml` — `session.activeDeadlineSeconds: 14400` documented with comments.
- Modify: `infra/helm/openvoid/README.md` — explain the failsafe semantics and the SIGTERM cascade interaction.

**Approach:**
- Documentation-only unit. The wiring already exists from Phase 4/5/9. This unit makes the failsafe legible to future implementers who didn't read the rev 4 decision log.

**Test scenarios:**
- Test expectation: none — documentation only. Verified by demo.
- Edge case (manual demo, takes 4+ hours): create a session and don't stop it. After 4 hours the pod transitions to `Terminating` with `Reason: DeadlineExceeded`; the SIGTERM cascade fires; the finalizer pushes whatever is in the workspace; the branch lands on GitHub.

**Verification:**
- `helm show values infra/helm/openvoid` lists `session.activeDeadlineSeconds` with a clear comment.
- Pod inspection: `kubectl get pod -n openvoid-sessions <pod> -o jsonpath='{.spec.activeDeadlineSeconds}'` returns the chart-configured value.

---

## Open Questions

(Filtered to questions still open at the start of Phase 8. See parent plan for resolved-during-planning, resolved-during-pivot, and resolved-during-Phase-N entries.)

### Carry-overs from Phase 7 — Residuals (deferred from ce:review on 2026-05-05)

The `ce:review` of the Phase 7 PR surfaced 11 P2/P3 items that are addressed in this plan or by the companion landing-page-redesign plan. Most apply to Phase 8 / Phase 9; a few are opportunistic.

- **Auth-header password validation.** `loadOpencodeAuthHeader` base64-decodes the Secret value and embeds it in the per-session Ingress `configuration-snippet` annotation. No runtime validation against nginx metacharacters. **Owner:** Phase 9.1 — when the chart graduates Secret generation, add a quote-safety validation at boot.
- **CORS empty-env hardening.** `landingOrigin()` silently falls back to the kind default if `OPENVOID_LANDING_ORIGIN` is set but empty. **Owner:** Phase 8.3 — DOKS env-var wiring.
- **`openapi-typescript` defaults-as-required workaround.** `services/landing/src/api.ts` carries a local `CreateSessionInput` type to work around the codegen quirk. **Goes away** when the Remix landing replaces the vanilla TS — see companion plan.
- **Polling-error retry on transient failures.** `pollUntilReady` exits to idle on the first API error, even transient 5xx. **Goes away** with the Remix replacement (see companion plan).
- **Ingress readiness gate.** `routes/sessions.ts` surfaces `agentUrl`/`previewUrl` when `pod.status.phase === Running`, but ingress-nginx may need 1–5s to program new host rules. **Owner:** Phase 9 — add an `ingressReady` field or hold URLs until the LB is provisioned.
- **`opencode-server-password` Secret rotation watcher.** Session API caches `authHeaderValue` at boot; rotating the Secret requires API restart. **Owner:** Phase 9.1 when the Secret becomes chart-managed.
- **Internal-IP exposure via `endpointUrl`.** `GET /sessions/:id` returns `endpointUrl: http://<podIP>` when a pod has an IP. **Owner:** Phase 8 / Phase 9 — small TypeSpec change to drop the field.
- **Agent-native readiness.** No agent-facing tool layer (Vercel AI SDK / MCP / function definitions) and no system prompt documents the session lifecycle. A `GET /sessions` (list) endpoint is also missing. **Owner:** Phase 8 — author at least one example agent integration before public DOKS ships.
- **K8s client error-shape robustness (`is404` helper).** Reads three error properties by `as`-casting unknown. **Owner:** opportunistic — next time the SDK is upgraded.
- **`SessionOps.getSessionPod` naming.** After the `createSession*Resources` / `deleteSession*Resources` rename, `getSessionPod` is the only Pod-named method remaining. **Owner:** opportunistic.
- **Vite `allowedHosts: true` DNS-rebinding trade-off.** Documented in instructions but unmitigated. **Goes away** with the Remix replacement (no Vite in the new landing).

### Specific to Phases 8–10

- **DOKS LB + cloudflared cost during dev.** `infra/remote/doks-destroy.sh` tears it down, but a forgotten cluster eats ~$24–34/mo. Should the chart-managed default include any cost-aware tooling (e.g., automatic uninstall after N hours of inactivity)? Probably not for v1; documented in `infra/remote/README.md`.
- **GHCR visibility flip for first push.** Each new package needs `Settings → Packages → Public` after first push, OR an image-pull-secret. Should Phase 8.3 / Phase 9.5 use authenticated pulls instead, to avoid the manual flip? Open until Phase 9.5 lands.
- **NetworkPolicy FQDN vs CIDR allowlist on DOKS.** GitHub's published IP ranges vs the cluster's CNI FQDN support. Cilium supports FQDN; DigitalOcean's CNI is Cilium-based. Phase 10.1 should pick one and document. Default lean: FQDN.

## References

- **Parent plan (history + foundation):** [`docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md`](2026-05-01-001-feat-v1-staged-walkthrough-plan.md)
- **Companion plan (landing-page redesign):** [`docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md`](2026-05-05-002-feat-landing-page-redesign-plan.md) — *forthcoming, drafted via `/ce:plan`*
- **Origin document:** [`docs/brainstorms/2026-05-01-monorepo-layout-requirements.md`](../brainstorms/2026-05-01-monorepo-layout-requirements.md)
- **Sidecar-vs-operator research (rev 4 driver):** [`docs/research/compass_artifact_wf-1d15406b-b208-438f-b5fc-2eca8ce7267e_text_markdown.md`](../research/compass_artifact_wf-1d15406b-b208-438f-b5fc-2eca8ce7267e_text_markdown.md)
- **OpenCode endpoint spike (Phase 0.3):** [`docs/spikes/2026-05-02-opencode-endpoints.md`](../spikes/2026-05-02-opencode-endpoints.md)
- **Helm-routing-abstraction learning:** [`docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md`](../solutions/best-practices/helm-routing-abstraction-2026-05-03.md)
- **Native sidecar containers (K8s):** https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/
- **Cloudflare Tunnel + Kubernetes guide:** https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deployment-guides/kubernetes/
- **DigitalOcean Kubernetes LoadBalancer docs:** https://docs.digitalocean.com/products/kubernetes/how-to/configure-load-balancers/
- **ArgoCD declarative setup:** https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/
