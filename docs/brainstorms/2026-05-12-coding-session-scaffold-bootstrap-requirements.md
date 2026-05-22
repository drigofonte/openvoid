---
date: 2026-05-12
topic: coding-session-scaffold-bootstrap
---

# Coding Session Scaffold Bootstrap

## Summary

Introduce a "new app" entry point for openvoid coding sessions in which the platform creates a per-app repo on its source-control org, seeds it from a versioned scaffold template, and brings up a working Vite + React + RR7 dev server on port 3000 before the session reports Running — so the user's first live-preview load is a deliberate empty state, never a 503.

---

## Problem Frame

openvoid's v1 lifecycle assumes the user provides a repo URL at session creation. The agent then edits files inside that repo, and the user watches the live preview update. This works for the demoable end-to-end milestone, but it imposes two costs that are increasingly visible as the product matures toward its intended audience:

1. **It requires a repo and a dev server before there is anything to preview.** For a non-technical operator who wants to prototype an idea, "first create a Git repo and a runnable dev server" is a prerequisite they cannot satisfy. The product currently has no entry point for the user it is ultimately built for.
2. **The first preview load after Running has nothing serving on port 3000** until the agent does its first useful action. The Provisioning Hi-Fi storyboard we just shipped makes pre-Running feel deliberate; post-Running the user clicks "Open preview" and lands on a connection-refused page. The asymmetry undermines the storyboard.

The user this affects is a business operator with an idea who wants to prototype it quickly, publish a working version for validation, and not burn tokens having the agent generate boilerplate from scratch. They are token-conscious, non-technical, and impressionable in the first 30 seconds.

---

## Actors

- A1. **Business operator** — non-technical user starting a new app session. Wants to validate an idea, watches the token meter, judges the product in the first 30 seconds.
- A2. **Landing page** — the static site at `services/landing/` that today surfaces session URLs and runs the Provisioning storyboard.
- A3. **Session API** — creates session pods and reports status; today's `services/session-api/`.
- A4. **workspace-init sidecar** — the init container that prepares the session workspace. Today named `git-clone`; this brainstorm expands its responsibilities and recommends the rename.
- A5. **OpenCode agent** — the AI coding agent running as the session pod's main container.
- A6. **Platform source-control org** — a single GitHub org (e.g. `openvoid-platform`) that owns all user app repos and the scaffold template repo.

---

## Key Flows

- F1. **New app session — first time**
  - **Trigger:** A1 chooses "Start a new app" on the landing page and (optionally) types a one-line description of the idea.
  - **Actors:** A1, A2, A3, A4, A5, A6
  - **Steps:**
    1. A2 calls A3's `POST /sessions` with `mode: "new-app"` and the optional prompt
    2. A3 generates the repo name as a slug from the prompt plus a short random suffix, creates the repo on A6, then creates the session pod with A4 as an init container
    3. A4 clones the scaffold template repo from A6, strips its `.git`, reinitialises against the new app repo, writes the user's prompt into a known-named metadata file inside the seeded source, commits, pushes, and runs `pnpm install`
    4. A5 starts; the dev server starts in the same container and binds `0.0.0.0:3000`
    5. A3 holds session status at Provisioning until an HTTP probe to the pod's port 3000 returns 2xx, then flips to Running
    6. A2's Provisioning storyboard advances through its five steps as it receives real signals from A3 for repo-created, scaffold-seeded, install-done, dev-server-up, and ready
    7. A1 clicks "Open preview" and lands on the scaffold's deliberate empty-state index route, which displays their prompt by reading the metadata file
  - **Outcome:** A1's first live-preview load shows a designed empty state on a real running app; the app repo exists on A6 and is ready for A5 to extend
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10

v1 ships only F1. There is no flow for returning to a previously-created app — see Scope Boundaries.

---

## Boot sequence — Provisioning storyboard mapped to real events

```
Storyboard step                  Real event the step waits on
─────────────────────────────    ────────────────────────────────────────────
1. Provisioning workspace        Session API: pod scheduled, workspace volume bound
2. Cloning scaffold              workspace-init: scaffold template clone complete
3. Initialising app repo         workspace-init: new app repo created on platform org + initial push complete
4. Installing dependencies       workspace-init: `pnpm install` exit 0
5. Starting dev server           Session API: HTTP probe to pod port 3000 returns 2xx
                                 → status flips to Running, preview URL surfaced
```

Today's Hi-Fi storyboard runs on a fixed ~25s timer. R5 retires that timer; the steps now reflect real progress.

---

## Requirements

**Entry point and source control**
- R1. The landing page exposes a "Start a new app" entry point that does not require a repo URL. The existing "paste a repo URL" entry point remains available as an "import existing project" path, additively.
- R2. The platform owns a single source-control org (GitHub in this iteration) under which all user app repos and the scaffold template repo live. No per-user Git credentials are used.
- R3. Each new app maps to a single repo on the platform org. The repo name is generated to guarantee uniqueness without requiring a collision-retry loop at the call site.

**Scaffold**
- R4. The canonical scaffold is a Vite + React + React Router v7 app in framework mode. The scaffold is genuinely minimum — no shadcn primitives pre-installed, no app shell, no theme provider, no auth stub, no sidebar, no layout components.
- R5. The scaffold's index route renders a deliberate empty state designed for first-load impression. When a session-creation prompt is captured, the empty state surfaces it by reading a committed metadata file written at seed time. The empty state's wording orients the user toward prompting the agent.
- R6. The scaffold ships a committed `README.md` that explains the scaffold's layout and asks the agent to extend rather than rebuild it. The constraint is soft (prompt-following), not hard (file locks).

**Workspace bootstrap**
- R7. When the entry point is "new app", the workspace-init sidecar (renamed from `git-clone`) clones the scaffold template, strips its history, reinitialises against the newly-created app repo, writes the session-creation prompt into the seeded metadata file, commits, pushes, and runs `pnpm install` — all synchronously, before the agent container starts.
- R8. The session does not report Running until an HTTP probe to the pod's port 3000 returns 2xx. Until then status remains Provisioning.
- R9. The dev server runs alongside the OpenCode agent inside the agent container for v1. A separate dev-server sidecar is a follow-up, not v1 scope.

**Storyboard alignment**
- R10. The Provisioning Hi-Fi storyboard's five steps are wired to real boot signals (per the table above), not a synthetic timer. Step advancement reflects observable progress, and the final step's completion is gated on the same probe as R8.

---

## Acceptance Examples

- AE1. **Covers R1, R7, R3.** Given A1 has not provided a repo URL, when A1 clicks "Start a new app" and submits a prompt of "todo list with reminders", then the platform creates a uniquely-named repo derived from that prompt on the platform org, seeds it from the scaffold, writes the prompt into the committed metadata file, and the agent container starts against that repo.

- AE2. **Covers R8, R10.** Given the session pod is scheduled and workspace-init has finished, when the Vite dev server has not yet bound port 3000, then the session status remains Provisioning, the storyboard's final step is unfinished, and the "Open preview" CTA is not yet shown. When the probe to port 3000 returns 2xx, status flips to Running, the storyboard's final step completes, and the CTA appears.

- AE3. **Covers R5.** Given A1 typed "AI flashcards" as their idea at session creation, when A1 lands on the live preview, then the index route displays a heading or card surface that includes the phrase "AI flashcards" alongside copy that invites A1 to prompt the agent.

- AE4. **Covers R3.** Given two users independently start new apps with the same prompt "todo list", when both sessions create repos on the platform org, then the two repos coexist with distinct names; neither call fails with a name-collision error and neither blocks waiting for a retry.

---

## Success Criteria

- A non-technical user opening a new-app session for the first time sees a designed page on `<sid>.preview.<domain>` within the same window that the Provisioning storyboard runs. They never see a 503, a connection refused, or a Vite "still loading" page they interpret as broken.
- The Provisioning storyboard never reports "Starting dev server" complete while the preview is in fact still down — i.e., the storyboard does not lie.
- `ce-plan` consuming this document does not need to invent the boot signal contract, the workspace-init responsibilities, the scaffold's contents, or the scaffold's relationship to the platform org. Implementation choices (HTTP probe shape, repo-naming algorithm, where exactly the prompt-file lives) are open; product behaviour is pinned.

---

## Scope Boundaries

- **Returning-user surface — deferred to v1.5.** v1 supports only the "new app, new session" path. There is no landing-page app picker, no app-listing API, no bookmarkable per-app URL, and no email-link recovery. App repos persist on the platform org once created, but are not reachable from the UI after the originating session ends. The new-app flow's architecture (repo per app, scaffold seed as a one-time step) keeps this addition cheap when v1.5 picks it up.
- Multiple scaffold templates or a template gallery — v1 ships one canonical scaffold.
- A pre-baked scaffold container image with prebuilt `node_modules` — deferred until install latency is visibly painful in practice.
- A dedicated dev-server sidecar — tracked as a v1.5 reliability follow-up.
- Azure DevOps support — named as a future target; not implemented in this iteration.
- shadcn/ui pre-installation, app shell, theme provider, dark mode toggle, auth stub, navigation primitives — explicitly excluded from the minimum scaffold. The agent installs what the user prompts for.
- Hard agent prompts that lock specific files (`vite.config.ts`, `app/root.tsx`, `package.json`) — soft README constraint only.
- A publish-and-share surface for the prototyped app — separate feature; this work delivers the prototyping side only.
- Token-budgeting UI, prompt-history persistence, billing — out of scope.

---

## Key Decisions

- **Minimum scaffold, not opinionated app shell.** The product's user is a non-technical idea-validator. A thinner scaffold gives the agent less to misinterpret and ships less long-term carrying cost. shadcn primitives and layout components can be agent-installed on demand.
- **Synchronous workspace prep over fast-boot via pre-baked image.** v1 accepts the `pnpm install` cost in exchange for one moving part (template repo) instead of two (template repo + scaffold image with its own CI). Revisit if cold-boot time becomes visibly painful.
- **Dev server inside the agent container for v1.** The sidecar split is correct architecture for reliability decoupling, but its value is hypothetical until agent crashes break previews in practice. Deferring keeps v1 scope tight without losing the idea.
- **Soft README constraint over hard file locks.** Locking files limits the agent's ability to genuinely deliver on a user prompt; a committed README is enough to nudge OpenCode toward extending rather than rebuilding.
- **The "import existing repo" flow stays.** Removing it would be a scope reduction we have not earned; it is the existing v1 demo path and serves a different audience (technical users).
- **Provisioning storyboard becomes truth-bearing.** Once "Running" means "preview works", the storyboard either reflects reality or it actively misleads. We choose reality.
- **Repo naming: slug-from-prompt plus short random suffix.** The suffix is the uniqueness strategy — no collision-retry loop, no failure-mode for the user, and human-readable names in the platform org. When the user supplies no prompt, the slug falls back to a generic `app-<suffix>` form.
- **Session prompt carried as committed JSON metadata.** Written by workspace-init at seed time, read by the scaffold's index route at render time. Versioned in git so the agent can inspect and evolve it; extensible to future fields (created-at, scaffold-version) without changing the seed contract. Chosen over string-replacement into the route source (which the agent could lose) and env-var (awkward to evolve into multi-field metadata).
- **No returning-user surface in v1.** Each new-app session creates a fresh repo on the platform org; previously-created apps are not reachable from the landing page. The persona's iterate-and-publish goal is partially served (the session itself can iterate) but the cross-session resumption is v1.5.

---

## Dependencies / Assumptions

- The platform owns a real GitHub org and a Personal Access Token / GitHub App credential with repo-create permission. This is consistent with the existing tenancy memory and the v1 `git-creds` Secret pattern but is not yet provisioned for the new-app path.
- The OpenCode agent reads `README.md` from the workspace and treats it as context during prompt-following. If this is not currently true, the soft constraint in R6 needs a different surface (e.g., a session-level system-prompt template) — flagged in Outstanding Questions.
- `pnpm` is the package manager in the agent container; the scaffold's lockfile is a `pnpm-lock.yaml`.
- The session pod's networking already exposes port 3000 via the `preview-http` named port and the per-session Ingress (verified in the v1 plan). This work does not require Ingress changes.
- The `Vite allowedHosts` concern previously flagged in the v1 plan (line 1356 — DNS-rebinding trade-off) applies to this scaffold and should be inherited by the scaffold's `vite.config.ts`. Not solved here; tracked at the v1 plan level.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] The GitHub repo-create API call and its credential handling — which Secret holds the platform-org token, how it is mounted into session-api or workspace-init, and how transient failures (rate limits, API outages) propagate to the user.
- [Affects R8][Technical] The HTTP probe shape and where it runs — Kubernetes readiness probe on the pod, a session-api side poll, or a workspace-init-emitted file marker observed by session-api.
- [Affects R6][Needs research] Whether OpenCode reliably reads `README.md` as context, and if not, where else the "extend, don't rebuild" instruction should live (system prompt template, dedicated tool config, agent prompt overlay).
- [Affects R10][Technical] How storyboard step transitions are signalled from session-api to the landing page — status fields on the session resource, SSE, polling.
- [Affects R2][Needs research] When and how Azure DevOps becomes a real target — abstraction layer in session-api now, or a clean rewrite later. Out of v1 scope; flagged here so v1 implementation does not paint into a corner.
- [Affects R3, R5][Technical] The exact shape of the slug + random-suffix algorithm (length, charset, slug truncation for long prompts, profanity-filtering on slugs) and the exact filename and JSON shape of the seed-time metadata file. Decided at planning time alongside the workspace-init implementation.
