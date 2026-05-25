---
date: 2026-05-23
updated: 2026-05-24
topic: roadmap-to-public-do-release
focus: build a roadmap for OpenVoid; next milestone is releasing it for others to use on a Digital Ocean cluster, behind 8 user-named UX/infra items
mode: repo-grounded
related:
  - docs/architecture/secrets-threat-model.md
  - docs/architecture/secrets-sequence-diagrams.md
  - docs/architecture/secrets-device-requirements.md
---

# Ideation: Roadmap to a Public Digital Ocean Release

## Grounding Context

OpenVoid today is a Remix 3 SSR landing (`services/landing/`), a Hono Session API + K8s client (`services/session-api/`), three per-session pod images (workspace-init initContainer → opencode agent main → git-finalizer sidecar that pushes on SIGTERM), and a TypeSpec contract (`packages/protocol/`) that generates OpenAPI + TS types. Tenancy is **many-users / one-platform-owned GitHub org** via a fine-grained PAT (Org Admin + Repo Admin + Contents R/W + Metadata R) — never per-user git credentials. v1 has **no multi-user auth**: the session URL + ingress-injected Basic Auth is the de-facto credential. Active phases are 8 (DOKS + cloudflared), 9 (Helm chart consolidation + ArgoCD GitOps), and 10 (NetworkPolicy, sandbox, `activeDeadlineSeconds=4h` failsafe). No `STRATEGY.md` exists; the v1 stance is "intentionally a proof, not a polished platform."

Captured learnings (`docs/solutions/`) include the Helm routing-mode abstraction (operator stays cluster-neutral, `routing.mode = cloudflared` for DOKS), the fine-grained-PAT permissions trap, the landing-ingress-readiness gate (`LANDING_SKIP_INGRESS_PROBE=true` is explicitly temporary), the per-session-pod 5-trap checklist (including a `git push -u` PAT-leak risk), and Remix 3 layout-primitive + JSX-attribute conventions. There are **no captured learnings** on BYOK, OpenCode UI customization, app-gallery UX, prompt-cost estimation, OpenRouter integration, billing/credits, Cloudflare-Tunnel ops, or DOKS sizing — these are the highest-risk surfaces for the release.

Prior art has converged across leading AI app-builders (Lovable, Bolt, v0, Replit, Magic Patterns) on **chat-first, code-as-side-channel** UX in a **persistent split-pane single tab**. **Lovable removed its public gallery on 2026-04-22 after a BOLA incident** — "project visibility" and "published-URL access" must be modeled as separate authz objects. Almost 40% of 5,000 Lovable+Replit apps audited exposed sensitive data (APD, 2026) — agents embedding secrets in generated code is a structural failure, not a one-off. OpenRouter's ToS **prohibits reselling credits**; the proven pattern is own-Stripe-Credits + single platform-owned OpenRouter org account proxying users. nginx dynamic-subdomain routing on DOKS has **IDOR risk** unless an admission check binds `$subdomain` to a live user-owned session. OSS app-builder economics show that **every sustainable OSS equivalent runs BYOK + local + zero hosting** — none has cracked sustainable cloud-hosted OSS without VC subsidy.

Cross-domain analogies that surfaced as load-bearing: Gitpod prewarmed workspace pools (~30s → ~3s cold start), hotel keycards (per-stay, expire on checkout), Twilio/SendGrid prepaid credits, Netlify/Vercel subdomain-per-branch deploy previews, ATC hold-queue bands (range over single-point estimates).

---

## Refinement note (2026-05-24)

Conversation refinement after the original ideation tightened the auth and secrets posture, added a ninth survivor, reversed the publishing model, and chose a push-based deployment pattern. Net architectural decisions:

- **Auth is required from v1; passkey-PRF enrolment is a hard gate.** No anonymous sessions, no degraded-tier fallback. Survivor 2's original anonymous-first framing is dropped and replaced with consumer-OAuth + mandatory passkey auth.
- **BYOK from v1; no platform-credit backend.** The OpenRouter resale problem is sidestepped by never reselling. The minutes-not-tokens pricing primitive is dropped — users pay OpenRouter directly under their own key. Survivor 3 is rewritten accordingly.
- **GitHub OAuth is removed from the user-facing surface.** The platform-owned GitHub org for per-app repos is invisible to users; identity comes from Google / Apple / Microsoft OAuth or email magic-link. The platform PAT (Org Admin + Repo Admin) still handles all user-facing repo operations.
- **Survivor 9 added — three-layer OpenBao secrets architecture.** Drafted in detail in `docs/architecture/secrets-threat-model.md`, `secrets-sequence-diagrams.md`, and `secrets-device-requirements.md`. OpenBao is a v1 commitment, not deferred to graduation.
- **Phasing shifts: OpenBao + passkey auth + BYOK all move into pre-cohort.** The original "weeks to public DO release" claim no longer holds; the pre-cohort phase is meaningfully bigger in exchange for shipping the right architecture once instead of refactoring later.
- **Publishing model reversed — OpenVoid hosts published apps on OpenVoid-controlled infra.** Survivor 4's original "publish targets the user's own infra (GitHub Pages, Vercel, their own DO droplet)" stance is reversed: dev + prod DOKS clusters under OpenVoid control, published apps live in per-app namespaces on the prod cluster.
- **Deployment is push-based (CI → cluster), not pull-based (cluster ← git).** ArgoCD is no longer the leading candidate; Terraform-from-CI (likely GitHub Actions) is. Item 2 ideation will work through the substantive tradeoffs (drift detection, multi-cluster state, in-cluster workload tool, bootstrap secrets).

The rejection summary at the bottom of this document records the specific items dropped or reversed in this refinement.

---

## Ranked Ideas

### 1. Reframe the public DO release as a closed-cohort invite-only beta

**Description:** Redefine the milestone. "Public release" becomes "public landing page + invite-only product, ~50 hand-picked users, ~6 months." Invites are one-time codes; the cohort is below OpenRouter's resale-detection threshold; cost-cap enforcement, abuse detection, rate limiting, and gallery moderation move from launch-blockers to fast-follows. Set an explicit graduation date (Nov 2026) for self-serve open signup.

**Warrant:** `external:` Cursor, Lovable, Bolt, and v0 all launched closed-cohort first; Lovable's BOLA incident (2026-04-22) happened *after* full public open, exactly the failure mode a small cohort catches. `direct:` v1 stance is already "intentionally a proof, not a polished platform" — open self-serve contradicts the team's own framing. `reasoned:` Five of the eight user-named roadmap items (3 gallery, 4 auth, 5 BYOK, 6 cost-est, 7 credits) exist to *serve* users who do not yet exist; deferring them until graduation cuts critical path by months.

**Rationale:** This is the highest-leverage reframe because it cascades into every other decision. With a closed cohort the team can ship platform-owned OpenRouter (legal at 50 users), defer Stripe/credit-purchase, defer full auth, defer abuse hardening, and still put the product in front of real users to gather interview-grade feedback. It also makes "graduation to open signup" the natural moment to harden — driven by user signal, not by speculation.

**Downsides:** Slower flywheel — no viral signup loop. Risk that "6 months" extends indefinitely if graduation criteria aren't defined upfront. Founder-curated cohorts can be biased toward people who confirm priors.

**Confidence:** 75%
**Complexity:** Low (mostly a planning artifact: graduation criteria + invite-code generation + waitlist form)
**Status:** Unexplored

---

### 2. Required consumer-OAuth + mandatory passkey enrolment (no anonymous path)

**Description:** Identity is required from the first session. The user-facing OAuth surface is consumer-grade — Google / Apple / Microsoft — plus email magic-link as a fallback. GitHub OAuth is *not* exposed; the platform-owned GitHub org for per-app repos authenticates via a platform PAT, invisible to users. After OAuth, the user is routed to a mandatory passkey enrolment flow with a WebAuthn-PRF capability probe (see survivor 9). Users whose browser or authenticator cannot satisfy PRF cannot create accounts — there is no degraded-tier fallback. Recovery codes are generated once at enrolment with a type-back confirmation step.

**Warrant:** `direct:` The tenancy memory note ("many-users / one-platform-owned source-control account; never per-user git credentials") means GitHub identity is structurally not what the platform needs from the user — repos are platform-owned regardless. `reasoned:` Coupling identity to secrets via passkey-PRF (survivor 9 Layer 1) requires a passkey to exist, so anon-first is architecturally incompatible. `external:` Consumer-OAuth + passkey is the modern shape (Stripe, Linear, GitHub itself for new accounts); GitHub-OAuth-first signals "this is for developers" on the front door, which contradicts the sophisticated-but-broader audience framing.

**Rationale:** Auth is no longer the largest deferrable workstream — it is the substrate that makes survivor 9 workable. Investing in it upfront avoids a v1.5 rip-and-replace when secrets land. The hard passkey gate is honest: it excludes ~5–10% of the developer cohort by browser/device, and that exclusion is the documented price of the threat model in `docs/architecture/secrets-threat-model.md`.

**Downsides:** Excludes users on old browsers, old hardware authenticators, or restrictive corporate-managed devices. Adds onboarding friction (passkey enrolment + recovery-code save) that competitors without per-user encryption do not pay. Some users will abandon at the recovery-codes screen; partly mitigated by passkey sync (iCloud Keychain / Google Password Manager) being the default recovery path for most users.

**Confidence:** 80%
**Complexity:** Medium (consumer-OAuth integrations + WebAuthn registration + PRF probe + recovery codes + device-not-supported UX)
**Status:** Decided 2026-05-24

---

### 3. BYOK-only AgentCredentials resolver at v1 (no platform-credit backend)

**Description:** A single `AgentCredentials` resolver inside Session API with one backend at v1: per-user BYOK against OpenRouter. The user stores their OpenRouter key during onboarding (encrypted under survivor 9's three-layer architecture); per-session pods materialise it into env vars via the staged-path flow at session start. Cost-estimation UX is honest bands attached to the agent's pre-flight plan ("this task typically uses 200K-800K tokens; at your current OpenRouter pricing that's roughly $0.50-$2.10"). No platform metering, no platform billing, no resale risk. The resolver primitive survives as the seam for future backends — direct Anthropic, Anthropic-on-Bedrock for enterprise, or per-app integration secrets like Stripe / Supabase.

**Warrant:** `direct:` BYOK-from-v1 is the explicit product decision (2026-05-24): OpenVoid's audience is sophisticated users accelerating their own work, not citizen-devs who need the platform to abstract billing. `direct:` OpenRouter ToS prohibits reselling credits — BYOK sidesteps the entire legal surface. `reasoned:` The "minutes-not-tokens" pricing primitive only makes sense when the platform owns the LLM bill; with BYOK, users pay OpenRouter directly and need pre-flight bands to estimate that bill, not a platform-quoted price.

**Rationale:** Removes the OpenRouter resale violation, Stripe/PCI scope, key-rotation incident plan, and platform-side bill-shock all in one. The resolver primitive still pays off — it becomes the substrate for v1.5 per-app integration secrets (Supabase, Stripe, etc.) which need the same per-session materialisation flow OpenRouter keys do. BYOK is a sophistication wall, not a bug: it filters for users who can paste an API key, which is the same audience that benefits from the rest of the product.

**Downsides:** OpenRouter onboarding (account, payment method, key generation) is now part of the OpenVoid signup flow even though it happens outside the platform — meaningful drop-off risk at this step. Inline guide + screenshots + possibly a deep-link to OpenRouter's key-creation page mitigate but do not eliminate. BYOK also means no per-platform usage signal — the team can't see "users burned $20K of tokens on Task X this week" without separately querying OpenRouter's API on behalf of consenting users.

**Confidence:** 85%
**Complexity:** Medium (resolver interface + BYOK key entry UX + OpenRouter onboarding flow + pre-flight band estimation)
**Status:** Decided 2026-05-24

---

### 4. Workspace-as-durable + snapshot/restore primitive (with "build" decoupled from "publish")

**Description:** Stop treating "an app" as the unit. The durable thing is a **workspace** = (long-lived directory + git history + env config + agent transcript). Pods are ephemeral compute leases attached to a workspace. Build one primitive — content-addressed snapshot of a workspace, restorable into a fresh namespace — and let it power resume, fork, "remix this", deploy previews per branch, and deterministic bug repro. **Separate "build" from "publish"**: the per-session pod runs the agent and serves the *preview*; publishing to a stable URL is an explicit, separate step that targets **OpenVoid-controlled DOKS clusters** (decided 2026-05-24: dev + prod clusters, both OpenVoid-managed; published apps live in per-app namespaces on the prod cluster).

**Warrant:** `external:` Netlify/Vercel deploy previews + Gitpod prewarmed pools both rest on snapshot-as-primitive. `direct:` "Git import is canonical resume" pattern across all leading tools. `reasoned:` The per-session pod is ephemeral by design, so the only durable artifact today is the SIGTERM git push — a fragile single point of state. Decoupling publish from build separates lifecycle concerns (preview = ephemeral compute lease; published = long-lived service) so each can be operated, isolated, and rolled back independently.

**Rationale:** Roadmap item 3 (gallery + resume + cross-user contribution) collapses to "list workspaces I have a recovery token for + restore one." Forking is "snapshot + new namespace." Cross-user contribution (your v1.5+ ambition) is "share a snapshot URL." Deploy previews per branch are "snapshot per branch." Publishing is "snapshot → build → deploy to per-app namespace on prod cluster." This is the leverage move that turns one primitive into 5-6 features.

**Downsides:** Major v1 architectural commit; reshapes the Session API contract. Hosting published apps on OpenVoid-controlled infra (reversed from the original survivor 4 deferral) opens a meaningful operational surface — per-app tenancy isolation, cost accountability, idle-suspend behaviour, per-app subdomain + cert, framework support, rollback strategy. These deserve their own ideation pass (the Item 3 ideation noted in the refinement log). Snapshot storage on DO Spaces has nontrivial cost at scale.

**Confidence:** 65%
**Complexity:** High (snapshot/restore engine + Session API contract changes + landing redesign + per-app build/deploy/host pipeline on prod cluster)
**Status:** Decided 2026-05-24 (publishing model) — implementation scope still to be ideated

---

### 5. Per-session namespace + capability tokens + ingress admission check (BOLA-structural)

**Description:** Make the per-session namespace the universal isolation primitive — auth identity, BYOK secret, preview URL, gallery access all key off it. Issue short-lived, capability-scoped tokens at session start ("edit this workspace," "view this preview," "publish to that target"), each narrow, each expiring, each revocable. Add an **nginx auth-request admission check** that validates `$subdomain` maps to a live session AND that the requester holds the right capability token — so dynamic-subdomain IDOR is closed by construction, not by hoping no one guesses.

**Warrant:** `external:` Lovable BOLA April 2026 — "PROJECT VISIBILITY and PUBLISHED-URL ACCESS must be modeled as separate authz objects." Helm routing-abstraction learning (2026-05-03) — DOKS uses cloudflared but the same primitives must hold under generic ingress later. `direct:` Phase 10 already invests in NetworkPolicy and `activeDeadlineSeconds=4h`; capability lifetime can bind to pod lifetime trivially. `reasoned:` Capability tokens compose with anonymous-first sessions (idea 2) — no user record is needed to issue a token, and snapshot-restore (idea 4) becomes "issue new tokens scoped to the restored namespace."

**Rationale:** This is the security architecture for everything else. It closes the IDOR risk explicitly flagged in DOKS dynamic-subdomain research, structurally prevents the Lovable BOLA failure mode, and gives a clean answer to "how do I share a preview URL with a friend without giving them edit access?" — which the gallery work otherwise has to figure out ad-hoc.

**Downsides:** Capability token lifecycle adds complexity that v1 single-operator deploys do not strictly need. nginx auth-request adds a per-request hop (latency). Token semantics must be designed before downstream features (gallery sharing, fork) start, which gates other work.

**Confidence:** 80%
**Complexity:** Medium-High (capability-token issuance + Session API hooks + nginx auth-request endpoint + per-session namespace conventions)
**Status:** Unexplored

---

### 6. View-mode primitive (chat-first default) + multi-client session backend

**Description:** Rather than choosing "split pane" or "tabbed" or "pop-out window" once, define **view-mode** as a URL-addressable enum: `chat-only` (default for new users), `split`, `preview-only`, `code-panel`. Lock-down for non-developers = `chat-only` is default with opt-in code panel. The split/joined choice is a default + a toggle, not a fork in the codebase. To unlock the **multi-window / second-monitor** experience nobody else has, make the session backend **multi-client at the contract level** — multiple WebSocket attachments per session, last-write-wins (or CRDT) on chat input. Then "open the preview on my second monitor" falls out for free.

**Warrant:** `external:` Field has converged on chat-first / code-as-side-channel (Lovable Chat-Only mode, Magic Patterns hides code entirely). No prior art for multi-window — likely because OpenCode-style single-client session backends *prevent it* rather than designers having chosen not to. `direct:` Remix 3 layout primitives learning (one outer max-width + Stack) gives the canonical composition shape for new view modes. `reasoned:` URL-addressable view-mode means support can say "open this link" and reproduce a user's exact view — compounding for debugging, demos, and shared gallery links.

**Rationale:** Collapses user-named items 1 (OpenCode UI lockdown) and 2 (split vs joined layout) into one architectural decision. Surfaces a possible differentiator (multi-client sessions = second-monitor previews) that no competitor offers, *if* the session backend is willing to break the single-client assumption early.

**Downsides:** Multi-client requires opencode-side changes that are out-of-scope for OpenVoid's repo. CRDT/last-write-wins for chat input has UX subtleties (interleaving partial messages). Adds complexity to a v1 that could ship with single-client split-pane and be fine.

**Confidence:** 60% (the view-mode primitive is high confidence; the multi-client backend is more speculative)
**Complexity:** Low for the view-mode toggle alone; High if multi-client is included
**Status:** Unexplored

---

### 7. Secrets guardrail + declarative egress allowlist + sandbox tiers for risky sessions

**Description:** Three composing layers, deployed in order: (a) hard-prompt the agent never to inline secrets, always reference env vars; (b) git-finalizer sidecar runs trufflehog-style scan on each diff before push, refuses commits with token-shaped strings, surfaces failure back to the agent UI; (c) the agent declares external hosts it needs ("npm registry, GitHub API, OpenAI") and the platform materializes a per-session NetworkPolicy from the declaration — default-deny everything else. For sessions handling user-provided BYOK keys, escalate to a higher sandbox tier (dedicated node, no preview-URL exposure, suggest-only diff review before any apply).

**Warrant:** `direct:` Per-session pod boot traps learning — `git push -u` already leaks PAT-shaped strings to stdout; the platform PAT (Org Admin + Repo Admin) is high blast-radius if leaked. `external:` ~40% of 5,000 Lovable+Replit apps exposed sensitive data; Lovable's hardcoded-Supabase-credentials incident is the canonical app-builder BYOK failure. Cline / Cursor use suggest-then-apply for high-risk operations. BSL containment-tiering analogy: the tier is inferred from agent actions, not chosen upfront.

**Rationale:** Phase 10's NetworkPolicy work is the natural seam to upgrade from "static egress allowlist" to "declarative per-session contract." The declaration also becomes user-facing trust signal ("this app talks to: stripe.com, sendgrid.net") — a Lovable-BOLA-class defense built into the gallery surface. Charges the safety cost only where it's earned (BSL-1 for "todo list," BSL-3 for "talks to my Anthropic key").

**Downsides:** Trufflehog has false positives that will block legitimate commits. Declarative egress relies on the agent being honest about its hosts, which it isn't always — needs a deny-default + retry flow. BSL tiering adds operational complexity (multiple pod templates).

**Confidence:** 70%
**Complexity:** Medium (system-prompt + finalizer scan + NetworkPolicy generator); High if BSL tiering is included
**Status:** Unexplored

---

### 8. Server-side ingress-readiness gate + mise-en-place step-pool (the first-impression fix)

**Description:** Two coupled investments for the moment a first-time user clicks Create. (a) **Push readiness server-side in Session API**: withhold `agentUrl` / `previewUrl` from `StatusResponse` until the ingress controller has actually programmed the host, and only then advance phase to `Ready`. Retire `LANDING_SKIP_INGRESS_PROBE`. (b) **Pool each expensive setup step independently** — workspace-init pod pre-cloning the scaffold and warming `node_modules`, ingress route pre-programmed via a placeholder, opencode pre-booted. Session creation becomes "claim the pre-staged tray, attach to the user's repo." Restaurant mise-en-place, not Gitpod-style whole-pod pooling.

**Warrant:** `direct:` Landing-ingress-probe post-mortem (2026-05-09) — `LANDING_SKIP_INGRESS_PROBE=true` is *explicitly* temporary; Phase 9 should retire it. `external:` Gitpod prewarmed pools cut cold-start from ~30s to ~3s; the restaurant mise-en-place analogy goes finer-grained still. `reasoned:` First-impression UX on a public DO release is binary: a 30-second progress bar with a possibly-broken URL at the end will tank conversion regardless of how good the agent is. Every leading app-builder feels instant.

**Rationale:** Independent of every other survivor on this list, this one ships pure UX value to anyone who actually uses the cohort beta (idea 1). It also resolves a documented temporary workaround that should not survive to public release. Plays well with the snapshot/restore primitive (idea 4) — restoring from a snapshot becomes "claim a pre-warmed pod and apply the snapshot," sub-second.

**Downsides:** Idle pods cost real DOKS spend — must be sized against expected concurrency. Step-pool adds operator surface (multiple pools to monitor + size). Risk of pool pods drifting from the live image if not rebuilt nightly.

**Confidence:** 75%
**Complexity:** Low for the readiness gate alone; Medium-High for the step-pool
**Status:** Unexplored

---

### 9. Three-layer OpenBao secrets architecture with passkey-PRF as the root of trust

**Description:** OpenBao deployed in-cluster from v1 as the secrets backplane for BYOK keys (OpenRouter at v1, per-app integrations at v1.5+). Designed so compromise of OpenBao alone cannot decrypt user secrets via three composing layers: (1) per-user KEK derived from passkey-PRF, never persisted server-side; (2) per-app DEKs wrapped by user KEK via OpenBao transit engine; (3) per-session pods authenticate via K8s SA JWT, fetch decrypted secrets via CSI Secrets Store Driver into tmpfs only, never into a Kubernetes `Secret` object. Detailed in `docs/architecture/secrets-threat-model.md` (11 enumerated threats with mitigations and residual risk), `secrets-sequence-diagrams.md` (4 Mermaid sequence diagrams covering enrolment, secret storage, session materialisation, and device-loss recovery), and `secrets-device-requirements.md` (passkey-PRF as a hard gate with explicit exclusion accounting). SOPS is still used, but only for cluster-bootstrap secrets (OpenBao's own unseal keys, platform PAT, TLS certs) — Shamir-split off-platform.

**Warrant:** `direct:` Survivors 3 (BYOK from v1), 5 (capability tokens), and 7 (per-session declared egress credentials) all need a dynamic per-user secret store; static K8s `Secret`s cannot model per-user scoping. `external:` E2E-encrypted services (Signal, 1Password) consistently use user-derived KEK + envelope encryption — this is the proven shape. CNCF/LF stewardship of OpenBao after the HashiCorp BSL change makes it the right long-term bet for self-hosted. `reasoned:` The single-attack-surface concern raised against centralised Vaults inverts when Vault holds *ciphertext* rather than plaintext — and that inversion is what user-KEK-from-PRF delivers.

**Rationale:** Designing the right architecture from v1 is cheaper than retrofitting. It also produces the most senior-engineer-coded artefacts in the repo — a written threat model, sequence diagrams, and an honest exclusion-accounting document — which compound for both team understanding and external portfolio narrative. The architecture has no degraded-tier fallback; users who can't enrol a passkey-PRF credential cannot use OpenVoid, and that's documented as a deliberate product choice in `secrets-device-requirements.md`.

**Downsides:** Operational burden — OpenBao HA, unseal flow, Shamir-key custody, audit log storage and rotation, CSI driver in the cluster. Excludes users on browsers/devices without PRF support (estimated 5–10% of the developer cohort). Key-recovery UX is genuinely hard: losing a passkey *and* recovery codes loses all stored secrets, and this needs honest first-run onboarding. OpenBao becomes the most attractive attack target in the cluster regardless of the layered design; network isolation, mTLS, and read-pattern anomaly detection become required, not optional.

**Confidence:** 85%
**Complexity:** High (OpenBao deployment + transit engine + K8s auth + CSI driver + passkey-PRF integration + key-recovery UX + three architecture docs maintained alongside code)
**Status:** Decided 2026-05-24

---

## Cross-cutting observations

- **Pre-cohort scope is now bigger than the original "weeks not months" framing suggested.** Survivors 2 (passkey auth), 3 (BYOK resolver), and 9 (OpenBao + three-layer architecture) are all pre-cohort. Honest range: 8–14 weeks to cohort opens, not 4–6.
- **Survivors 2 + 9 are one decision in two slots.** Auth (passkey enrolment) and secrets (KEK-from-PRF) share the WebAuthn primitive — they ship together or neither works.
- **Survivors 4-5 remain the architectural commits** that make v1.5+ cheap. Skipping them produces tactical wins now and an expensive rewrite later.
- **Survivor 6 (view-mode primitive)** is the only one that directly addresses user-named items 1 + 2; the rest treat UX as downstream of architecture.
- **Survivor 7 (secrets / egress / sandbox)** is the *prerequisite* for shipping per-app integration secrets safely; with BYOK-from-v1, this is more urgent than the original framing suggested.
- **Survivor 8 (readiness + step-pool)** is the only one purely about how launch *feels* to users — it stays valid no matter what is true about 1-7 and 9.

## Suggested phasing

Revised 2026-05-24 to reflect auth-required-from-v1, BYOK-from-v1, OpenBao-from-v1.

| Phase | Must land | Should land | Notes |
|---|---|---|---|
| **Pre-cohort launch (8–14 weeks)** | 1 (cohort + graduation criteria), 9 (three-layer OpenBao + threat model docs), 2 (consumer-OAuth + passkey-PRF enrolment), 3 (BYOK resolver against OpenRouter), 8a (server-side ingress-readiness gate — retires `LANDING_SKIP_INGRESS_PROBE`), platform DOKS + push-based CI/CD (dev + prod clusters, Terraform-from-CI — see Item 2 ideation, pending) | 5 (capability tokens scoped to "view session" + "edit session") | This phase is meaningfully bigger than the original draft suggested; auth + secrets + BYOK + deployable platform are a single coherent ship. |
| **Cohort opens** | 7a (system-prompt no-inline-secrets + finalizer trufflehog scan), 6a (chat-first view-mode default) | Pre-flight cost bands attached to agent plans | Smaller scope because 9 + 2 + 3 absorbed what was previously cohort-phase work. |
| **First 3 months of cohort** | 4 (workspace + snapshot/restore), 7b (declarative egress allowlist), per-app integration secrets onboarding (Stripe, Supabase, etc. via the survivor-9 resolver) | 8b (mise-en-place step-pool when concurrency demands it), 6b (multi-client backend if differentiation matters) | Per-app integration secrets are the natural extension of survivor 9 — same resolver, different backend per integration type. |
| **Toward open-signup graduation** | 7c (sandbox tiers), 5 (capability-token expansion: share / fork / publish), key-recovery hardening, public threat-model doc | Cost-purchase UI only if cohort signal demands it (BYOK means most users won't) | At graduation, the threat-model doc becomes a public artefact — strongest portfolio piece. |

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| F1.1 | Server-side ingress-readiness gate (standalone) | Subsumed into survivor 8 (bundled with step-pool) |
| F1.2 | PAT-leak audit + log scrubber | Tactical; below ambition floor as standalone roadmap item — folded into survivor 7 (secrets layer) |
| F1.3 | Per-session subdomain authz admission check | Subsumed into survivor 5 |
| F1.4 | Hotel-keycard session credential expiry | Subsumed into survivor 5 |
| F1.5 | Prewarmed per-session pod pool | Subsumed into survivor 8 (refined as mise-en-place step-pool, not whole-pod pool) |
| F1.6 | Honest cost bands on landing form | Subsumed into survivor 3 |
| F1.7 | Secrets-in-generated-code guardrail | Subsumed into survivor 7 |
| F1.8 | Session-recovery before authentication ships | Subsumed into survivor 2 |
| F1.9 | Cloudflare Tunnel + cert-manager ops runbook | Tactical; below ambition floor — execute as part of Phase 8 work, not as a roadmap item |
| F2.1 | Delete landing form; URL params become contract | Interesting but not a top-7 lever; relevant pieces (URL-addressable state) folded into survivor 6 |
| F2.2 | Kill git import; every session IS a fork | Subsumed into survivor 4 (snapshot/restore replaces both git-import and fork) |
| F2.3 | Replace pre-flight cost with hard credit cap | Subsumed into survivor 3 |
| F2.4 | Auto-DNS becomes one-click publish | Interesting but conflicts with survivor 4's "decouple build from publish"; better as a brainstorm sub-question |
| F2.5 | Desktop wrapper for long sessions | Borderline gimmick; subsumed into survivor 6 (view-mode primitive handles long-session windowing more cleanly) |
| F2.6 | No auth in v1 — session URL IS the auth | Subsumed into survivors 2 + 5 |
| F2.7 | Single platform OpenRouter; users never bring keys | Subsumed into survivor 3 (with BYOK as a v1.5 escape hatch) |
| F2.8 | Warm pod pool subtracts cold start | Subsumed into survivor 8 |
| F3.1 | Anonymous-first, claim-on-export | Subsumed into survivor 2 |
| F3.2 | GitHub as backup target, not source of truth | Too expensive relative to value at v1; snapshot-to-S3 + git-on-snapshot is a v2 architectural conversation, not a roadmap item |
| F3.3 | Release is closed-cohort beta with public landing | Subsumed into survivor 1 |
| F3.4 | "App" is misnomer; durable object is workspace | Subsumed into survivor 4 |
| F3.5 | Session-scoped capability tokens | Subsumed into survivor 5 |
| F3.6 | Compute prepaid in minutes, not tokens | Subsumed into survivor 3 |
| F3.7 | Multi-window IS the split-pane decision | Subsumed into survivor 6 |
| F3.8 | "Publish" is separate from "build" | Folded into survivor 4 as a core consequence |
| F3.9 | Session pod is unit of ownership, not user | Subsumed into survivor 4 |
| F4.1 | Extend TypeSpec to all cross-boundary contracts | Strong leverage move but implementation choice, not a roadmap decision; flag for survivors 3 + 4 + 5 implementations |
| F4.2 | Per-session namespace as universal isolation | Subsumed into survivor 5 |
| F4.3 | Routing-mode generalized to platform-adapter | Premature; only one cluster target (DOKS) for now — the captured Helm routing-mode learning already does the necessary abstraction |
| F4.4 | Session-state snapshot/restore primitive | Subsumed into survivor 4 |
| F4.5 | Credit-and-key abstraction | Subsumed into survivor 3 |
| F4.6 | docs/solutions as agent-queryable knowledge | Tangential to release goal; better as a separate engineering investment |
| F4.7 | Readiness-as-contract for all components | Subsumed into survivor 8 (with the narrower scope appropriate for v1) |
| F4.8 | Split-vs-joined as view-mode primitive | Subsumed into survivor 6 |
| F4.9 | Declarative egress allowlist | Subsumed into survivor 7 |
| F5.1 | Hospital-triage session admission | Too speculative for v1; bands (survivor 3) handle sizing well enough |
| F5.2 | Library inter-loan analogy for gallery | Subsumed into survivors 2 + 4 |
| F5.3 | Restaurant mise-en-place pipeline | Subsumed into survivor 8 (the analogy lives in the description) |
| F5.4 | Surge-priced weather-forecast cost bands | Subsumed into survivor 3 |
| F5.5 | BSL-2 sandboxing tiers | Subsumed into survivor 7 |
| F5.6 | Civic-ID separating identity / key / wallet | Subsumed across survivors 2 + 3 + 5 |
| F5.7 | Fitness-app streak-and-pause for resume | Subsumed into survivor 2 (resume UX framing) |
| F5.8 | Telecom number-porting for BYOK | Subsumed into survivors 3 + 7 |
| F5.9 | Hotel-housekeeping checkout protocol | Subsumed into survivor 4 (finalizer as the audit + persistence boundary) |
| F6.1 | Zero-server browser-only builder (WebContainers) | Subject-replacement — abandons the per-session-K8s-pod architecture entirely |
| F6.2 | Founder-mode single-user platform | Subsumed into survivor 1 (the cohort can include the founder as user 1) |
| F6.3 | Public-by-default gallery with mandatory forking | Defensible but contradicts the closed-cohort framing of survivor 1; revisit at graduation to open signup |
| F6.4 | Ten-minute sessions with aggressive suspend | Harms first-time UX more than it gains; bounded better by the 4h failsafe already in Phase 10 |
| F6.5 | BYOK-only from day one | **Re-accepted 2026-05-24** — survivor 3 now reflects BYOK-from-v1; the v1.5-escape-hatch ordering is reversed |
| F6.6 | API-only OpenVoid (CLI only) | Subject-replacement — reduces product to a dev-tool |
| F6.7 | Invite-only 50 users for 6 months | Subsumed into survivor 1 |
| F6.8 | Suggest-only diff review before apply | Subsumed into survivor 7 (escalated sandbox tier) |
| R7.1 | Anonymous-first sessions with claim-on-export (original survivor 2) | **Reversed 2026-05-24** — auth is required from v1 to make survivor 9's passkey-PRF KEK derivation possible; auth and secrets are architecturally one decision |
| R7.2 | Platform-owned OpenRouter org backend in AgentCredentials resolver | **Reversed 2026-05-24** — BYOK-only at v1; no platform-credit backend, no resale risk, no platform-side billing |
| R7.3 | Minutes-not-tokens pricing primitive | **Reversed 2026-05-24** — moot under BYOK; users pay OpenRouter directly |
| R7.4 | Tiered fallback (Tier 2 / Tier 3) for non-PRF devices | **Reversed 2026-05-24** — passkey-PRF is a hard prerequisite; users without it cannot create accounts; see `docs/architecture/secrets-device-requirements.md` |
| R7.5 | GitHub OAuth on user-facing surface | **Reversed 2026-05-24** — user-facing identity is Google / Apple / Microsoft + email magic-link; GitHub remains the platform-owned repo store but is invisible to users |
| R7.6 | "Platform does not host published apps at v1" (original survivor 4) | **Reversed 2026-05-24** — OpenVoid hosts published apps on OpenVoid-controlled DOKS infra (dev + prod clusters); per-app namespace isolation, dedicated Item 3 ideation pass to follow |
| R7.7 | Pull-based GitOps (ArgoCD reconciling from git) as deployment pattern | **Reversed 2026-05-24** — push-based deployment (CI → cluster) is preferred; Terraform-from-CI is the leading candidate; ArgoCD originally referenced in Phase 9 is not the chosen tool |
