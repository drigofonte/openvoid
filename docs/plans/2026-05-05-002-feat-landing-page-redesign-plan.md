---
title: "feat: landing page redesign — Remix 3 + wireframe-faithful UX"
type: feat
status: active
date: 2026-05-05
revision: 2
deepened: 2026-05-05
companion: docs/plans/2026-05-05-001-feat-v1-production-readiness-plan.md
---

# Landing Page Redesign — Remix 3 + Wireframe-Faithful UX

> **⚠️ Beta-grade dependency.** This plan targets **Remix 3**, which entered public beta on **2026-04-29** as `remix@3.0.0-beta.0`. The team explicitly says "kick the tires"; APIs renamed within the beta release week. The plan pins to a fixed version, treats churn as a known risk, and documents an [explicit fallback to React Router 7](#migration--fallback-path) if Remix 3 GA slips past Q3 2026. Read the [Beta-Risk Posture](#beta-risk-posture) section before committing time.

## Overview

Replace the throwaway vanilla-TS landing page in `services/landing/` with a **Remix 3** application that implements the four user-facing screens designed in the Claude Design bundle (`OpenVoid Wireframes.html`):

- **Create** — full-page prompt-first form (variant 02-B from the wireframes).
- **Provisioning** — progress-card with five labelled steps mapped to Pod lifecycle (variant 03-A).
- **Two-links (Ready)** — split cards for agent UI + live preview, side by side, plus a Stop button (variant 04-A).
- **Kill flow** — three sub-states in sequence: confirm modal (06-A), in-flight log (06-B), done banner on the Create screen (a simplified composite of 06-C, redirected — see "Done-state strategy" in [Key Technical Decisions](#key-technical-decisions)).

The Session API surface (3 endpoints — `POST /sessions`, `GET /sessions/:id`, `DELETE /sessions/:id`) is unchanged. Only `services/landing/` is rewritten; the existing `services/session-api/` keeps its contract. The Helm chart hooks from the [companion production-readiness plan](2026-05-05-001-feat-v1-production-readiness-plan.md) (Phase 9.1's `landing.{image,host}` values) work unchanged — only the image contents and the runtime env-var contract change.

This plan ships **independently of the production-readiness plan** but co-evolves with it: the runtime env-var contract for the API URL (`OPENVOID_API_URL`) is the new integration point, replacing Phase 7's build-arg pattern (`VITE_OPENVOID_API_URL`).

## Beta-Risk Posture

The Remix team's own framing of the 3.0.0-beta.0 release: *"This is still a pre-release… not production ready yet… ready for you to kick the tires and tell us where the sharp edges are."* What this concretely means for the plan:

- **APIs change inside the beta.** Between alpha.4 and beta.0, the `remix/component` package was removed and consolidated under `remix/ui`. Expect more renames before GA.
- **Documentation is sparse.** There is no comprehensive docs site yet. The canonical reference is the [`demos/bookstore`](https://github.com/remix-run/remix/tree/main/demos/bookstore) application source and the per-package `README.md` files. Plan readers and implementers should bookmark the bookstore demo.
- **No migration path from Remix v2 / RR7.** Remix 3 is a clean break — different component model, different routing, different runtime. Existing React libraries do not work without rewrites.
- **Testing path is non-standard.** The framework ships its own runner (`remix/test`) on Node's native test-runner shape, not vitest.
- **Node ≥ 24.3.0** is the runtime floor. The session-api runs Node 20; the landing runs Node 24+. Per-service Node versioning is part of this plan.

The plan accepts these risks because the user has explicitly chosen Remix 3 over React Router 7 for this rewrite. Mitigations (exact-version pin, weekly-bump budget, fallback clause) are in [Key Technical Decisions](#key-technical-decisions).

## Problem Frame

The Phase 7 landing page is intentionally throwaway: vanilla TypeScript, ~160 lines, ~4.6 KB JS bundle, served by nginx. It has earned its keep — the kind magic moment works. But it has known limitations the user has accepted:

- The visual design is minimal-functional (one form, two URLs, one button). The Claude Design bundle's wireframes are richer and friendlier (Vercel-ish minimal aesthetic, warm off-white palette, sectioned states).
- The polling logic is hand-rolled — `AbortController`, double-submit guard, and several `ce:review` findings ago there were race conditions. The new design should use the framework's well-tested abstractions for the same shape (Remix 3 ships `Frame` + `handle.reload()` + first-class `AbortSignal` plumbing through `on('click', async (e, signal) => …)`).
- The build-time API URL means kind and DOKS need separate image builds. Remix 3's "runtime over build steps" principle collapses that — `process.env.OPENVOID_API_URL` is read in controllers per request.
- The `openapi-typescript` "default makes field required" workaround in `services/landing/src/api.ts` exists only because the client makes the API call. With server-side controllers, the framework consumes the API response shape directly — no workaround needed.

The replacement is the **long-term front-end direction**, not another stop-gap. It will live until full auth + dashboard + publish workflows ship (a separate plan). Quality bar is correspondingly higher — but scope is still tightly held to the four screens above. List-of-apps, dashboard, app detail, and publish flow are explicitly deferred (see [Scope Boundaries](#scope-boundaries)).

## Requirements Trace

- **R1 — Wireframe fidelity for the four in-scope screens.** Visual treatment matches the warm-off-white + accent-orange + Inter/JetBrains Mono system documented in the bundle's `wireframe-primitives.jsx`. Components fit at the densities and shapes shown in the canvas.
- **R2 — Same end-to-end flow as Phase 7.** Browser → Create → POST → Provisioning (polling) → Two-links → Stop → DELETE (polling) → Done. No regression on the kind magic moment.
- **R3 — Status-gated URL contract preserved.** The new UI promotes to "Ready" only when `status === "Running"` AND both `agentUrl` and `previewUrl` are present, exactly matching the current `LandingState.onSession` gate.
- **R4 — Runtime API URL.** A single image works for both kind (kind-context env override) and DOKS (chart-set env). Replaces the Phase 7 build-arg.
- **R5 — Closes Phase 7 ce:review residuals where applicable.** Specifically: (a) the `openapi-typescript` defaulted-fields workaround disappears (server-side controllers), (b) the polling-error retry is upgraded (Frame reload + AbortSignal handling), (c) the Vite `allowedHosts` trade-off becomes moot (no Vite in the new landing), (d) double-submit defence remains via a `clientEntry` pending-state pattern.
- **R6 — Helm chart hook compatibility.** The Phase 9.1 chart templates (`landing/{deployment.yaml,service.yaml,ingress.yaml}`) work unchanged with the new image; only the env-var contract differs. Resource budget tuned for a Node process (matches `services/session-api`'s shape).
- **R7 — Migration / fallback safety.** If Remix 3 GA slips beyond Q3 2026, the project can migrate the same scope to React Router 7 without re-doing UX, copy, or visual design. Documented in [Migration / Fallback Path](#migration--fallback-path).

## Scope Boundaries

In scope:
- The four screens listed in the Overview, with all states (idle / submitting / provisioning / ready / stopping / done) per the wireframes.
- Single Remix 3 server, single image, single Helm value-set.
- Deep linking to `/sessions/:id` works at any state (refresh during provisioning, share the URL with a teammate during Ready, etc.).
- `remix/test` tests for controller logic and view-state derivation. The existing six-scenario state-machine test surface is preserved (rewritten against `remix/test` semantics).
- Multi-stage Dockerfile on Node 24-alpine.
- Tilt and infra/local manifest updates.
- **Installation of three Remix dev skills** from the upstream Remix repo, committed under `.claude/skills/` for any contributor with Claude Code.

Explicitly **NOT in scope** (do not build, even though the wireframes show them):
- **Authentication / login.** No NextAuth, no GitHub OAuth, no JWT. The wireframe persona "maria" is decorative; the avatar is a static initial.
- **Dashboard / Apps home (wireframe section 01).** No list of past sessions; no "back to apps" navigation.
- **App detail / continue working (wireframe section 05).** No resume-existing-session flow.
- **Publish draft → promote to production (wireframe section 07).** No two-URL split; no draft.
- **App naming / `<name>.openvoid.dev` slugs.** Sessions are ULID-addressed; the URL bar shows session IDs, not slugs.
- **Full kill-recap stats** (commit message, files changed, +/- lines, duration, commit SHA). MVP recap is "Saved. View on GitHub →" with the `feat/<sid>` branch link, derived from the user's submitted repo URL. The Session API does not yet expose finalizer stats; surfacing them is a v1.5+ ask.
- **Stack / DB / framework chips.** The "Stack: auto, DB: postgres, Attach 📎" chips in the wireframe's create screen are inert UI in v1 (the agent figures out the stack from the prompt). Render them disabled or omit; do not wire them.
- **"Notify me when ready" / email-when-done.** The wireframe variant 03-C copy ("You can close this tab. We'll email you…") is aspirational; v1 has no email integration.
- **Tip carousels** ("While you wait" tips on Provisioning variant 03-C). Skipped for v1.
- **Real-time terminal log streaming** (Kill-flow variant B's commit log). MVP version is a spinner + "Saving and shutting down" copy; the API doesn't stream finalizer output.
- **Cookies / session persistence in the browser.** Refresh of `/` shows blank Create. No cross-tab "your in-flight session" awareness. Resume-by-URL works (paste `/sessions/:id`).
- **Suggestion-chip auto-population** (the Notion-clone / URL-shortener suggestions). Render the chips, but they only insert text into the textarea — no template selection, no scaffolding biases.

## Context & Research

### Relevant Code and Patterns

- **Session API contract** the controllers must call: [`services/session-api/src/routes/sessions.ts`](../../services/session-api/src/routes/sessions.ts). Three endpoints, `Session` shape with status-gated `agentUrl`/`previewUrl`, error envelope `{code, message}` with codes `invalid_body` / `invalid_request` / `k8s_unavailable` / `not_found`.
- **CORS allowlist** at [`services/session-api/src/server.ts`](../../services/session-api/src/server.ts) — single-origin via `OPENVOID_LANDING_ORIGIN`. Server-side controllers bypass CORS entirely (server-to-server), so the dev story is simpler than today.
- **State-derivation logic to port** — the gate `status === "Running" && agentUrl && previewUrl` lives in [`services/landing/src/state.ts`](../../services/landing/src/state.ts). Lift verbatim into a pure function consumed by controllers. The corresponding test in [`services/landing/test/state.test.ts`](../../services/landing/test/state.test.ts) carries six scenarios — keep them, adapt to `remix/test` semantics.
- **Polling pattern (current)** — [`services/landing/src/app.ts`](../../services/landing/src/app.ts) lines 67–115: 1s for first 30s → 5s after, 90s timeout, single-flight `AbortController`. The new shape uses Remix 3's `<Frame>` driven by a `clientEntry` wrapper that calls `handle.reload()` on a `setInterval`; `AbortSignal` handling is first-class through the framework.
- **Double-submit guard** — current [`services/landing/src/app.ts`](../../services/landing/src/app.ts) lines 116–152 disables button via `submitButton.disabled`. New shape: a `clientEntry`-wrapped submit button holds a local `pending` boolean toggled in the `on('click', async (e, signal) => …)` handler with `handle.update()` calls.
- **Multi-stage Dockerfile pattern** — [`services/session-api/Dockerfile`](../../services/session-api/Dockerfile) is the closest reference: builder → dev → runtime, `pnpm deploy --prod /opt/<pkg>`, `USER node`. The current [`services/landing/Dockerfile`](../../services/landing/Dockerfile) is a simpler 2-stage Vite → nginx; replace with a Remix-3-shaped variant: Node 24-alpine, `tsx server.ts` as the runtime command, no bundler step.
- **Tilt resource shape** — [`Tiltfile`](../../Tiltfile) lines 50–80 (the landing block): `docker_build` from repo root with `only=[…]` allowlist, `k8s_resource` with port_forward + labels. Update build target/ports for the Node-24 server; drop the `VITE_OPENVOID_API_URL` build-arg.
- **Manifest** — [`infra/local/landing.yaml`](../../infra/local/landing.yaml) defines Deployment + Service + Ingress at `app.127.0.0.1.nip.io`. Bump resource limits (currently tuned for nginx-static, recommend matching `services/session-api`'s `requests: 50m/96Mi, limits: 500m/256Mi`), update containerPort to 3000, drop the build-arg dependency, add an `env: [{name: OPENVOID_API_URL, ...}]` block.
- **Protocol types** — [`packages/protocol/main.tsp`](../../packages/protocol/main.tsp) and [`packages/protocol/generated/types.ts`](../../packages/protocol/generated/types.ts). Controllers import `import type { components } from "@openvoid/protocol"` and use `components["schemas"]["Session"]` etc.

### Institutional Learnings

- **[`docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md`](../solutions/best-practices/helm-routing-abstraction-2026-05-03.md)** — Known Pattern, directly applicable. The chart's `landing/` templates must stay cluster-neutral; cluster-fabric differences (cloudflared vs nip.io, etc.) belong in `templates/routing/*.yaml`, not in the landing Deployment. The Remix 3 Dockerfile should also apply the SCC-friendly file-ownership snippet (`chgrp -R 0 + chmod -R g=u` before `USER node`) for v1.5 OpenShift readiness, matching what the OpenCode image already does.

No prior solutions exist in `docs/solutions/` for: Remix 3 application structure, `<Frame>`-based polling, runtime env-var injection patterns in Node servers, vanilla-TS-to-Remix-3 component porting, or design-token theming through `remix/ui`. After this work lands, **multiple `/ce:compound` candidates** are obvious — the polling cadence pattern, the runtime env-var pattern, the design-token approach, and notably any framework-pinning gotchas discovered against the moving beta.

### External References

- **Remix 3 Beta Preview blog (2026-04-29):** https://remix.run/blog/remix-3-beta-preview — the canonical "what to expect" post. Read first.
- **Remix 3 source repo:** https://github.com/remix-run/remix — note that this is the same repo that previously hosted Remix v2; v2 source was moved aside, `main` is now Remix 3.
- **Bookstore demo (canonical worked example):** https://github.com/remix-run/remix/tree/main/demos/bookstore — the most reliable code reference until docs ship. Consult per-unit during implementation.
- **`packages/ui` README (component primitives, mixins, context):** https://github.com/remix-run/remix/blob/main/packages/ui/README.md
- **`packages/fetch-router` README (router/controller contract):** https://github.com/remix-run/remix/blob/main/packages/fetch-router/README.md
- **Community resource hub (talks, demos, integrations):** https://github.com/markdalgleish/remix3-resources
- **Examples repo (state mgmt, animation, i18n integrations):** https://github.com/sergiodxa/remix-v3-examples
- **Wake up, Remix! announcement (2025-05-28):** https://remix.run/blog/wake-up-remix — the Preact-fork rationale.
- **Wireframe bundle source:** `OpenVoid Wireframes.html` from the Claude Design handoff (preserved at `/tmp/openvoid-design/openvoid/` during planning; the conversation is at `chats/chat1.md`). The `screens-*.jsx` files document component shapes; `wireframe-primitives.jsx` documents the design tokens.

## Key Technical Decisions

- **Stack: Remix 3 in beta, pinned exactly.** Dependencies: `remix@3.0.0-beta.0` (single runtime package — everything is exported from there) plus `tsx` for dev/prod (no separate bundler). Pin with no `^`, no `next`, no `latest`. Budget for a controlled bump every 2–4 weeks; review changelog and bookstore-demo diff before each bump.

- **Fallback to React Router 7 documented.** If Remix 3 hasn't reached GA by **2026-09-30** (end of Q3), the project migrates the same screens, scope, and visual design to RR7. The migration is mechanical for the wireframes (CSS variables and component shapes are framework-neutral), substantive for the controllers/routes (different contract). See [Migration / Fallback Path](#migration--fallback-path).

- **All Session API calls go through Remix 3 controllers.** The browser never talks to the Session API directly. Three direct consequences:
  - CORS becomes a non-issue (server-to-server has no `Origin`).
  - The Phase 7 `openapi-typescript` defaulted-fields workaround disappears — the controller validates input server-side and returns typed responses to the rendered JSX.
  - `OPENVOID_API_URL` is a runtime env var read in controllers (`process.env.OPENVOID_API_URL`), not a build-time constant. One image, two clusters.

- **Routing: config-based via `app/routes.ts`.** Remix 3 dropped file-based routing. Routes are typed via `Controller<typeof routes.X>` for compile-time URL/param checking. Two routes for v1:
  - `/` — Create (idle) + Done banner (when `?done=…` present).
  - `/sessions/:id` — Provisioning, Ready, Kill-in-flight, Failed, Timeout — all derived from a controller-side `deriveView()` over the `Session` payload.

- **Component model: controllers + JSX `render()`, with `clientEntry` for interactivity.**
  - Controllers run server-side, fetch the Session, derive the view, and `render(<Page data={view}/>)`.
  - Static UI is plain JSX returned from page components.
  - Interactive UI (form-with-pending-state, polling regions, stop-button confirm flow) is wrapped in `clientEntry(...)` — the only path to client-side state in Remix 3. State is closure variables; updates are explicit `handle.update()` calls. **No `useState`, no `useEffect`.** This is the single biggest learning curve for the implementer.

- **Done-state strategy: redirect to `/?done=:id&repo=<url>&branch=<name>`** rather than a tombstone on `/sessions/:id`. The Create screen renders a banner above the textarea: "Saved to `<branch>` on `<repo>`. View on GitHub →" with a "Start another" affordance baked in (the form below is the affordance). Avoids requiring the API to retain any post-DELETE state. *(Spec-flow analyzer's recommended option B.)*

- **Cancel-during-provisioning**: the Provisioning screen shows a "Cancel" button (not "Stop"). Cancel issues DELETE and redirects to `/` with no Done banner — nothing was saved, so no link to surface. Prevents the 4-hour orphan-pod scenario when a user changes their mind mid-provisioning. The "Stop" button (with confirm + commit) only appears in the Ready state, when there's actual work to commit.

- **Polling cadence:**
  - **Provisioning (status: Pending):** 1 s for first 30 s, then 5 s. After 90 s elapsed, **do not abandon** — switch the heading copy to "This is taking longer than usual…" and slow polling to 10 s. The user can cancel manually.
  - **Ready (status: Running):** stop polling entirely. The status is terminal-stable until the user acts.
  - **Kill-in-flight (post-DELETE):** 1 s, with a 30 s timeout, then redirect to `/?done=…` regardless.
  - **Mechanism:** `<Frame src="/api/sessions/:id/status">` rendered inside a `clientEntry` that owns the polling timer. `handle.reload()` on the Frame triggers a re-fetch. Cleanup via the `signal.addEventListener('abort', clearInterval)` pattern from the bookstore demo's `cart-button.tsx`.

- **Read-after-write reliability:** the `/sessions/:id` controller retries `GET /sessions/:id` upstream up to 3× with 200 ms backoff before treating a 404 as terminal. Defends against the read-after-POST consistency window. Cheap, well-bounded.

- **Ingress-readiness gate:** before transitioning to Ready, the controller does a HEAD probe against `previewUrl` (and `agentUrl`) with a 3 s timeout each. If both respond, render Ready. If either is still 502/404, render Provisioning with a "Almost ready…" copy and continue polling. *(Mitigates the Phase 7 ce:review residual at the controller layer; production-readiness Phase 9 should ideally push this server-side via an `Ingress.status.loadBalancer.ingress` check, but this controller-side fallback is the v1 backstop.)*

- **Double-submit defence:** UI-side via a `clientEntry` button that flips a `pending` closure variable on `on('click', async (e, signal) => …)` and calls `handle.update()` to disable itself. Plus a hidden `idempotency-key` form field generated via `crypto.randomUUID()` per-mount, forwarded by the controller to the Session API as `Idempotency-Key: <uuid>`. *(API may not enforce the header today — flag in Open Questions.)*

- **CSS strategy:** plain CSS with CSS variables, served as a static asset and `<link rel="stylesheet">`'d from `app/ui/document.tsx`. The wireframe's design tokens lift directly to `app/styles/theme.css`. **Do not** adopt `remix/ui`'s `createTheme()` — the existing CSS-variable approach maps cleanly onto Remix 3's own theming model and avoids coupling to a moving API.

- **Test runner: `remix/test`** (Node native test-runner shape, exposed as `remix test`). Diverges from the rest of the repo (which uses vitest), but is on the supported framework path. Use `playwright` for any future E2E (the bookstore demo has Playwright wired up; v1 doesn't ship E2E).

- **Image-agnostic chart templates.** The Phase 9.1 templates work unchanged. This plan only changes:
  - The image (`localhost:5001/openvoid/landing:dev` → same name, new content).
  - The container port (3000 — the Remix 3 server's listen port; replace nginx port 80).
  - The Deployment `env:` block (adds `OPENVOID_API_URL` runtime config).
  - Resource requests/limits (Node process budget instead of nginx-static).
  - The base image (`node:24-alpine` instead of `nginx:1.27-alpine`).

- **Per-service Node version.** `services/landing/package.json` sets `engines.node: ">=24.3.0"`. Repo root `engines.node` stays at `>=20`. `services/session-api/` continues on Node 20. CI matrix and Tilt are aware of the split.

- **Remix dev skills installed locally.** Three skills from the upstream Remix repo (`expert-typescript-programmer`, `write-tests`, `author-ui-modules`) are committed under `.claude/skills/` so any contributor opening the repo with Claude Code has framework-shaped guidance available. See [Unit 1](#unit-1-install-remix-dev-skills--scaffold-the-remix-3-app) and [Sources & References](#sources--references).

## Migration / Fallback Path

Remix 3 is beta. If GA slips beyond **2026-09-30**, this plan migrates to React Router 7 with the following mechanical steps. Documented up-front so the project always has an exit option.

**What stays unchanged (framework-neutral assets):**
- `services/landing/app/styles/theme.css` — CSS variables and design tokens.
- All visual design — wireframe fidelity, copy, layouts, density.
- The four screens' state machines and decisions (done-state redirect, cancel-during-provisioning, polling cadence, ingress-readiness gate).
- The user-facing routing scheme (`/` and `/sessions/:id`).
- The `infra/local/landing.yaml` manifest shape (env-var contract, ports, resources).
- The Helm chart templates from companion plan Phase 9.1.

**What is rewritten on migration:**
- Dependencies: `remix@3.0.0-beta.0` → `react-router@7.x`, `@react-router/serve`, `@react-router/dev`, `react`, `react-dom`. Add `vite`.
- Routes: `app/routes.ts` config-based → RR7's `app/routes.ts` config-based with file conventions (similar shape, different helpers).
- Component model: Remix 3 controllers + JSX `render()` → RR7 `loader`/`action`/default-export route modules. Component bodies become React (functional components with hooks).
- Polling: `<Frame>` + `handle.reload()` → `useFetcher.load()` + `setInterval`.
- Forms: plain `<form>` + `clientEntry` pending state → `<Form method="post">` + `useNavigation()`.
- Production server: `tsx server.ts` → `react-router-serve build/server/index.js`.
- Build: no bundler → Vite (build step required).
- Dockerfile: `node:24-alpine` → `node:20-alpine` (RR7 floor is Node 20). Add Vite build stage.
- Tests: `remix/test` → vitest. Lift assertions verbatim; rewrite the runner shape.
- Skills: replace the three Remix-specific skills under `.claude/skills/` with RR7-equivalents (RR7 doesn't ship official skills today; community skills may exist by then).

**Estimated migration cost:** ~3–5 days for an implementer familiar with both stacks. The visual + UX work survives entirely; only the framework wiring is redone.

**Trigger conditions:**
- Q3 2026 ends (2026-09-30) without a `remix@3.0.0` GA release, OR
- Two consecutive minor versions during Q2/Q3 2026 introduce breaking renames that exceed the 2-week refactor budget, OR
- A production-blocking issue surfaces in `remix@3.0.0-beta.x` that the team cannot mitigate within one sprint.

## Open Questions

### Resolved during planning

- **Framework choice.** Remix 3 in beta, pinned exactly. RR7 fallback documented if GA slips past Q3 2026.
- **Server adapter.** Bring-your-own — `app/server.ts` wires `createRequestListener(router)` into Node's `http.createServer()`, modeled on the bookstore demo. No `@react-router/serve` analog exists; not needed for v1.
- **CSS approach.** Plain CSS + CSS variables, served as static asset. No `createTheme()`.
- **Done-state strategy.** Redirect to `/?done=:id&repo=&branch=` (option B). Tombstone deferred.
- **Cancel UX in Provisioning.** Show a "Cancel" button; click DELETEs and returns to `/` with a clean slate.
- **Kill-flow routing.** Three sub-states on the same `/sessions/:id` route, derived from controller payload + a small client-side "stopping" overlay.
- **Browser back/forward semantics.**
  - Back from Provisioning → Create: leaves the session running (acceptable; the user can deep-link back).
  - Two-links should `replace` history when transitioning from Provisioning, so back from Ready returns to Create, not back to a stale Provisioning render.
  - Done banner on Create: back from a kill-redirect doesn't try to navigate forward into the dead session.
- **Test framework.** `remix/test` (Node native test-runner). No vitest in this package; rest of repo unchanged.
- **Node version split.** Per-service: landing on Node 24.3+, session-api stays on Node 20.

### Deferred to implementation

- **Idempotency-Key header support in the Session API.** The redesign sends it; if the API ignores it today, defence is UI-side only. File a Session API ticket if the API team wants to enforce. Not blocking.
- **Form encoding.** `<form>` posts URL-encoded by default. JSON bodies require a manual content-type override in the controller. Lean URL-encoded (browser-native, simpler).
- **Suggestion chips behaviour.** When a chip is clicked, does the textarea contents get *appended* (to support stacking) or *replaced*? Probably replaced (cleaner). Decide during component build.
- **Failure-state copy.** The wireframes lack a Failed-state design. Implementation will compose one from existing primitives (red eyebrow + card + retry CTA). Light design pass during the Provisioning unit.
- **Exact `handle.onMount` API.** The polling pattern relies on a lifecycle hook on `Handle`. The bookstore demo shows `signal.addEventListener('abort', …)` patterns inside `on('click', ...)` handlers, but the framework-level "run on mount" hook is undocumented. Validate against the latest `packages/ui` README before relying on a specific API name.

### Reserved for future plans / API tickets

- **Init-container error attribution.** Today GET `/sessions/:id` returns `status: Failed` with no machine-readable reason. **Suggested API surface:** add `failureReason: { code, message, hint? }` to the `Session` model. Documented as Phase 8/9 follow-up in the production-readiness plan.
- **GitHub branch URL derivation.** The Done banner needs to link to `<repo>/tree/feat/<sid>`. The redesign computes this client-side from the submitted repo URL and the session ID. Failure mode: if the repo URL ends in `.git` or has a trailing slash, normalise. Track as a v1.5 source-of-truth concern (have the API echo `branchUrl` so the UI doesn't reconstruct).
- **Server-pushed lifecycle events.** Polling is the v1 mechanism; an SSE or WebSocket lifecycle channel from the Session API would let the UI react instantly. Out of scope; revisit when activity-aware idle is reintroduced (v1.5).
- **A11y screen-reader announcements.** The Provisioning state transitions deserve `aria-live="polite"` regions. Not blocking for v1; track as a polish item.
- **`remix@3.0.0-beta.x` upgrade cadence.** Plan author should review the Remix release cadence weekly during the implementation period and bump pinned version with controlled refactors. Document the bump procedure in the `services/landing/README.md`.

## High-Level Technical Design

> *This sketches the route shape and component contract to validate direction. It is **directional guidance, not implementation specification**. Verify against the bookstore demo's current source before relying on specific API names — Remix 3 is in beta and APIs renamed within the release week.*

### Route module shape

```
services/landing/
  app/
    routes.ts                # typed route table (config-based; file routing dropped)
    router.ts                # composes middleware + maps controllers to routes
    actions/
      home/
        controller.tsx       # GET / — Create + Done; POST / — create-session action
        page.tsx             # CreatePage component
        client/
          submit-button.tsx  # clientEntry: pending-state submit
      sessions/
        controller.tsx       # GET /sessions/:id — view-derived render; POST /sessions/:id with intent=stop|cancel
        page.tsx             # SessionPage; renders Provisioning|Ready|KillInFlight|Failed|Timeout
        client/
          status-frame.tsx   # clientEntry: <Frame> + polling timer
          stop-button.tsx    # clientEntry: confirm + DELETE
      api/
        sessions-status/
          controller.tsx     # GET /api/sessions/:id/status — JSON; consumed by status-frame Frame
    ui/
      document.tsx           # <html> shell, <link> theme.css, <link> base.css
      layout.tsx             # shared layout
      logo.tsx, top-bar.tsx, card.tsx, button.tsx, chip.tsx, input.tsx,
      textarea.tsx, progress-track.tsx, status-dot.tsx, eyebrow.tsx
    middleware/
      static-assets.ts       # serves /assets/*
    utils/
      api.ts                 # process.env.OPENVOID_API_URL fetch helpers (server-only)
      derive.ts              # deriveView(session) pure function (mirrors current state.ts)
      poll.ts                # pollCadenceMs(elapsedMs), isTerminal(view) — pure helpers
      github.ts              # branchUrl(repoUrl, branch) — pure helper
    styles/
      theme.css              # design tokens (CSS vars from wireframe-primitives.jsx)
      base.css               # element resets / typography
  test/
    utils/
      derive.test.ts         # six scenarios from current state.test.ts, ported
      poll.test.ts
      api.test.ts
      github.test.ts
    actions/
      home.controller.test.ts
      sessions.controller.test.ts
  server.ts                  # http.createServer(createRequestListener(router))
  package.json
  tsconfig.json              # jsx=react-jsx, jsxImportSource=remix/ui, strict, ESNext
```

### State-derivation logic (lifted from current state.ts, Remix 3 idiom)

```ts
// app/utils/derive.ts — directional sketch
import type { components } from "@openvoid/protocol";
type Session = components["schemas"]["Session"];

export type View =
  | { kind: "provisioning"; pendingPhase: "pending" | "initializing" | "running-pre-ingress" }
  | { kind: "ready"; agentUrl: string; previewUrl: string }
  | { kind: "failed"; reason?: string }
  | { kind: "stopped" };

export function deriveView(session: Session): View {
  if (session.status === "Failed")
    return { kind: "failed", reason: session.failureReason?.message };
  if (session.status === "Stopped") return { kind: "stopped" };
  if (session.status === "Running" && session.agentUrl && session.previewUrl)
    return { kind: "ready", agentUrl: session.agentUrl, previewUrl: session.previewUrl };
  return { kind: "provisioning", pendingPhase: derivePhase(session) };
}
```

### Controller shape (server-side)

```ts
// app/actions/sessions/controller.tsx — directional sketch
import type { Controller } from 'remix/fetch-router';
import { redirect } from 'remix/response';
import { render } from '../../render';
import { deriveView } from '../../utils/derive';
import { getSession, deleteSession } from '../../utils/api';
import type { routes } from '../../routes';
import { SessionPage } from './page';

export default {
  actions: {
    async show({ params }) {
      const session = await getSessionWithRetry(params.id, { retries: 3, backoffMs: 200 });
      if (!session) return render(<SessionNotFound/>, { status: 404 });
      const view = await gateOnIngressReadiness(deriveView(session));
      return render(<SessionPage view={view} sessionId={params.id}/>);
    },
    async stop({ params, get }) {
      await deleteSession(params.id);
      const session = await getSession(params.id).catch(() => null);
      const repo = session?.repo ?? get(FormData)?.get('repo');
      const branch = session?.branch ?? get(FormData)?.get('branch') ?? 'main';
      return redirect(routes.home.href({ done: params.id, repo, branch }));
    },
    async cancel({ params }) {
      await deleteSession(params.id).catch(() => null);
      return redirect(routes.home.href());
    },
  },
} satisfies Controller<typeof routes.sessions>;
```

### Polling shape (clientEntry)

```ts
// app/actions/sessions/client/status-frame.tsx — directional sketch
import { type Handle, clientEntry, on, Frame } from 'remix/ui';

export default clientEntry(function StatusFrame(handle, { sessionId, frameSrc }) {
  const start = Date.now();
  let interval = 1000;
  const id = setInterval(() => {
    const elapsed = Date.now() - start;
    if (elapsed > 90_000) interval = 10_000;
    else if (elapsed > 30_000) interval = 5_000;
    handle.reload(); // reloads the enclosing <Frame>
  }, interval);
  // (cleanup on unmount via handle's lifecycle — exact API name to verify)
  return () => <Frame src={frameSrc}/>;
});
```

### Action shape (Create form)

```ts
// app/actions/home/controller.tsx — directional sketch
import { redirect } from 'remix/response';
import * as s from 'remix/data-schema';
import type { Controller } from 'remix/fetch-router';

const CreateSchema = s.object({
  repo: s.string(),
  branch: s.optional(s.string()),
  idempotencyKey: s.string(),
});

export default {
  actions: {
    async index({ url }) {
      const done = url.searchParams.get('done');
      return render(<CreatePage doneBanner={done ? parseDone(url.searchParams) : null}/>);
    },
    async create({ get }) {
      const input = s.parse(CreateSchema, get(FormData));
      const res = await fetch(`${process.env.OPENVOID_API_URL}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': input.idempotencyKey },
        body: JSON.stringify({ repo: input.repo, branch: input.branch }),
      });
      if (!res.ok) {
        const err = await res.json();
        return render(<CreatePage error={err}/>, { status: res.status });
      }
      const session = await res.json();
      return redirect(routes.sessions.href({ id: session.sessionId }));
    },
  },
} satisfies Controller<typeof routes.home>;
```

## Implementation Units

- [ ] **Unit 1: Install Remix dev skills + scaffold the Remix 3 app**

**Goal:** A bootable Remix 3 app at `services/landing/` with the design-token theme imported globally and a small primitives library porting the `wireframe-primitives.jsx` shapes. Three Remix dev skills from the upstream repo are installed under `.claude/skills/` so any contributor with Claude Code has framework-shaped guidance available. No business logic yet — the index controller renders a placeholder so the bring-up is testable.

**Requirements:** R1 (visual fidelity foundation), R6 (chart hook compatibility — package name + image name unchanged).

**Dependencies:** None (greenfield within the existing `services/landing/` directory).

**Files:**
- Delete: `services/landing/index.html`, `services/landing/nginx.conf`, `services/landing/vite.config.ts`, `services/landing/src/api.ts`, `services/landing/src/app.ts`, `services/landing/src/state.ts`, `services/landing/src/styles.css`, `services/landing/test/state.test.ts` (logic + tests reborn in Unit 2).
- Replace: `services/landing/package.json` — `engines.node: ">=24.3.0"`; dependencies: `remix@3.0.0-beta.0` (single runtime dep); devDependencies: `@types/dom-navigation`, `@types/node`, `tsx`, `@openvoid/protocol: workspace:*`. Scripts: `dev`, `start`, `test` (invokes `remix test`), `typecheck`.
- Replace: `services/landing/tsconfig.json` — `"jsx": "react-jsx"`, `"jsxImportSource": "remix/ui"`, `"module": "ES2022"`, `"target": "ESNext"`, `"moduleResolution": "Bundler"`, `"strict": true`, `"verbatimModuleSyntax": true`, `"allowImportingTsExtensions": true`. No `noEmit` (controllers + JSX run via `tsx`).
- Create: `services/landing/server.ts` — `http.createServer(createRequestListener(router)).listen(port)`. Reads `process.env.PORT` (default 3000).
- Create: `services/landing/app/routes.ts` — typed route config: `home`, `sessions`, `api.sessionsStatus`.
- Create: `services/landing/app/router.ts` — composes middleware (static assets) + maps controllers to routes.
- Create: `services/landing/app/ui/document.tsx` — `<html>` shell, `<link rel="stylesheet">` for theme.css and base.css.
- Create: `services/landing/app/ui/layout.tsx`, `app/ui/{logo,top-bar,card,button,chip,eyebrow,input,textarea,progress-track,status-dot}.tsx` — primitives matching the wireframe shapes. Components return render functions per Remix 3 convention.
- Create: `services/landing/app/styles/theme.css` — design tokens lifted from `wireframe-primitives.jsx`'s `WF` const (CSS custom properties: `--wf-bg`, `--wf-fg`, `--wf-accent`, etc.).
- Create: `services/landing/app/styles/base.css` — element resets, typography, body bg.
- Create: `services/landing/app/middleware/static-assets.ts` — serves `/assets/*` from the asset-entry pipeline.
- Create: `services/landing/app/actions/home/{controller.tsx,page.tsx}` — placeholder Create stub.
- Create: `.claude/skills/expert-typescript-programmer/SKILL.md` — fetched verbatim from `remix-run/remix:.agents/skills/expert-typescript-programmer/SKILL.md`.
- Create: `.claude/skills/write-tests/SKILL.md` — fetched verbatim from the same upstream path.
- Create: `.claude/skills/author-ui-modules/SKILL.md` — fetched verbatim from the same upstream path.
- Create: `scripts/sync-remix-skills.sh` — small idempotent script that fetches the three SKILL.md files from `remix-run/remix@<pinned-sha>` via `gh api` and writes them under `.claude/skills/`. Document the upstream commit SHA inline so updates are deliberate.
- Modify: `services/landing/README.md` — drop "throwaway" disclaimer; document local dev (`pnpm --filter @openvoid/landing dev`), env-var contract (`OPENVOID_API_URL`, `PORT`), beta-version warning + bump procedure, link to bookstore demo as the canonical reference, link to the three installed skills.

**Approach:**
- Fresh `services/landing/` keeps the directory and package name (`@openvoid/landing`) so Helm + Tilt names don't change.
- Skill installation: `scripts/sync-remix-skills.sh` runs `gh api repos/remix-run/remix/contents/.agents/skills/<skill>/SKILL.md` for each of the three skills, decodes base64, writes to `.claude/skills/<skill>/SKILL.md`. Pin to a known-good SHA in the script header; bumping the SHA is a deliberate operation.
- Bootstrapping order: `pnpm install` lands the single `remix` dep tree; `pnpm --filter @openvoid/landing dev` runs `tsx watch server.ts`; visit `http://localhost:3000/` and see the placeholder.
- Theme port: copy the `WF` const + injected `<style>` block from `wireframe-primitives.jsx` into `theme.css`, replacing JS template literals with CSS custom properties (`--wf-bg`, `--wf-fg`, etc.). Component primitives consume the variables.
- Primitives are thin: `<Card>` is a component returning a render function `() => <div class="wf-card">{children}</div>`; `<Button variant="primary"|...>` switches the class. Match the bookstore demo's component shape (`packages/ui` README is the reference).
- TypeScript imports use the `.tsx` extension explicitly (Remix 3's `verbatimModuleSyntax` requires it).
- Per-service Node version: the landing's `package.json` declares `engines.node: ">=24.3.0"`. The repo root `package.json` stays at `>=20`. Tilt + CI honour the per-package floor by reading the package's own engines.

**Patterns to follow:**
- Bookstore demo (`demos/bookstore` in remix-run/remix repo): directory layout, `app/routes.ts` shape, `tsconfig.json` settings, `server.ts` shape, `package.json` deps.
- `packages/ui/README.md` (in remix-run/remix repo) for component primitive conventions and the `mix={on(...)}` handler pattern.
- The installed `author-ui-modules` skill for primitive-component idioms.
- `services/session-api/Dockerfile` for the eventual 3-stage Dockerfile (applied in Unit 5).

**Test scenarios:**
- *Happy path:* `pnpm --filter @openvoid/landing dev` boots `tsx watch server.ts`, root route renders the placeholder, no console errors, fonts load.
- *Happy path:* the three skill files exist under `.claude/skills/`, each with valid frontmatter (`name`, `description` parseable as YAML).
- *Happy path:* `bash scripts/sync-remix-skills.sh` is idempotent — running twice produces the same files (no diff).
- *Edge case:* `pnpm --filter @openvoid/landing typecheck` passes (catches `jsxImportSource` config; if missing, `tsc` errors).
- *Integration:* `pnpm install` from repo root succeeds (lockfile regenerated, no peer-dep warnings that block install). The single-`remix` dep tree pulls Preact (vendored), `@remix-run/*` packages, but no React.

**Verification:**
- `pnpm --filter @openvoid/landing typecheck` returns 0.
- Skills are present and have valid SKILL.md frontmatter (script-level check).
- Visual check: dev server placeholder renders with the expected font (Inter) + background (#FAFAF9) — confirms theme.css is wired through document.tsx.

---

- [ ] **Unit 2: API helpers + view-state derivation + tests**

**Goal:** A small server-only utilities layer that wraps fetch calls to the Session API, plus the pure `deriveView()` function that turns a `Session` payload into a discriminated `View` union (lifted from the current `state.ts`'s `onSession` gate). Both are unit-tested with `remix/test`.

**Requirements:** R3 (status-gated URL contract), R5 (closes ce:review residuals — the workaround disappears here).

**Dependencies:** Unit 1.

**Files:**
- Create: `services/landing/app/utils/api.ts` — fetch wrapper: `getSession(id, signal?)`, `getSessionWithRetry(id, opts)`, `createSession(input, idempotencyKey)`, `deleteSession(id)`. Returns typed `components["schemas"]["Session"]` from `@openvoid/protocol`. Throws typed `ApiError` (with `code`, `message`, `status`) on non-2xx. **Server-only by construction** — controllers are server-only, so no `.server` suffix is needed (Remix 3 doesn't have a client-bundle for these files).
- Create: `services/landing/app/utils/derive.ts` — pure `deriveView(session)` returning a discriminated union mirroring the gating logic from the old `LandingState.onSession`.
- Create: `services/landing/app/utils/poll.ts` — pure helpers: `pollCadenceMs(elapsedMs)` returning the next interval (1000 → 5000 → 10000); `isTerminal(view)` returning true for ready/failed/stopped.
- Create: `services/landing/app/utils/github.ts` — pure `branchUrl(repoUrl, branch)` that normalises `.git` suffix and trailing slashes, strips embedded credentials, URL-encodes branch.
- Create: `services/landing/test/utils/derive.test.ts` — six scenarios from the original `state.test.ts` ported (initial idle, idle→creating→ready, Pending non-promotion, Running-without-URLs non-promotion, Failed→idle, ready→stopping). Plus a new one: Stopped → done.
- Create: `services/landing/test/utils/poll.test.ts` — cadence boundaries (0, 30000, 90000 ms; terminal-after-90000), idempotent terminal detection.
- Create: `services/landing/test/utils/api.test.ts` — fetch is mocked via `t.mock.method(globalThis, 'fetch')` (Node native test runner): 201 returns `{sessionId, status}`, 404 throws `ApiError(status=404)`, 503 throws `ApiError(code='k8s_unavailable')`, network failure throws `ApiError(status=0)`. Includes retry-with-backoff happy and exhausted paths.
- Create: `services/landing/test/utils/github.test.ts` — `.git` suffix, trailing slash, embedded credentials stripped, branch with slashes URL-encoded.

**Approach:**
- `api.ts` reads `process.env.OPENVOID_API_URL` once at module load (or per-call, debatable; lean toward per-call so tests can stub). Override path for tests via a `setApiBase()` helper.
- `getSessionWithRetry(id, {retries, backoffMs})` retries on 404 (read-after-write), not on 5xx. 5xx throws immediately (controller-side mapping decides what to render).
- `deriveView` is a `switch` over `session.status` with the `agentUrl && previewUrl` guard. Returning a discriminated union lets the page component exhaustively render branches without truthy-checking individual fields.
- `poll.ts` is calendar-style stateless: given the elapsed time, return the next cadence. The `setInterval` lives in the `clientEntry` polling component (Unit 4) but reads from `pollCadenceMs(elapsed)`.
- The `openapi-typescript` defaulted-required workaround disappears: `createSession({repo, branch})` accepts a relaxed input shape because the controller has already validated the form input via `s.parse(CreateSchema, get(FormData))`. The compile-time generated type is fine for the *response* (consumed by the controller); inputs are validated at the boundary.
- All tests use `remix/test` shape: `import { describe, it, beforeEach } from 'remix/test'`, `t.mock.fn()` for mocking, `t.assert.equal` for assertions. The `write-tests` skill (installed in Unit 1) is the authoritative reference for idioms.

**Patterns to follow:**
- The current `services/landing/test/state.test.ts` six scenarios — lift verbatim into `derive.test.ts` with `remix/test` syntax.
- The installed `write-tests` skill for `remix/test` patterns.
- `services/session-api/src/k8s/client.ts` `loadOpencodeAuthHeader` — fail-fast at boot when an env var is required.

**Test scenarios:**
- *Happy path:* `deriveView({status:"Pending"})` returns `{kind:"provisioning", ...}`.
- *Happy path:* `deriveView({status:"Running", agentUrl, previewUrl})` returns `{kind:"ready", agentUrl, previewUrl}`.
- *Edge case:* `deriveView({status:"Running"})` (no URLs) returns `{kind:"provisioning", ...}` — the gating regression guard.
- *Edge case:* `deriveView({status:"Failed", failureReason:{message:"x"}})` returns `{kind:"failed", reason:"x"}`.
- *Edge case:* `pollCadenceMs(0)` is 1000; `pollCadenceMs(30000)` is 5000; `pollCadenceMs(91000)` is 10000.
- *Error path:* `getSession("missing")` throws `ApiError` with `status===404`.
- *Error path:* `getSession()` with `OPENVOID_API_URL` unset throws clearly.
- *Happy path:* `getSessionWithRetry("just-created", {retries:3, backoffMs:1})` succeeds on the second attempt when the first returns 404 and the second returns 200 (mocked sequence).
- *Edge case:* `getSessionWithRetry("missing", {retries:3, backoffMs:1})` throws after exhausting all 3 attempts when all return 404.
- *Edge case (github):* `branchUrl("https://github.com/x/y.git/", "feat/foo")` returns `"https://github.com/x/y/tree/feat%2Ffoo"`.

**Verification:**
- All test scenarios pass under `pnpm --filter @openvoid/landing test`.
- Typecheck clean.

---

- [ ] **Unit 3: Create screen — controller + page + clientEntry submit button**

**Goal:** Implements wireframe variant 02-B (full-page prompt-first). The home controller's `index` action renders the Create page (with optional Done banner from `?done=…`); the `create` action validates the form and POSTs to the Session API, then redirects to `/sessions/:id`. The submit button is a `clientEntry` that flips a `pending` closure on click and calls `handle.update()` to disable itself — the double-submit guard, Remix-3-shape.

**Requirements:** R1, R2, R5.

**Dependencies:** Unit 1, Unit 2.

**Files:**
- Replace: `services/landing/app/actions/home/controller.tsx` — full home controller. `index` reads `?done=` query and renders Create + optional banner. `create` validates form, POSTs upstream, redirects on 201 or re-renders on error.
- Create: `services/landing/app/actions/home/page.tsx` — `CreatePage` component. Wireframe variant 02-B layout: title, eyebrow, textarea, branch input, suggestion chips, inert chips (disabled), submit-button slot (`clientEntry`).
- Create: `services/landing/app/actions/home/client/submit-button.tsx` — `clientEntry`-wrapped submit button. Closure-state `pending`; `mix={on('click', async (e, signal) => { pending=true; handle.update(); /* form submits natively */ })}`. Auto-resets after navigation (server response triggers full page render).
- Create: `services/landing/app/actions/home/done-banner.tsx` — pure component rendered above the form when `?done=` is present. Pulls `repo` + `branch` from the query; computes the GitHub branch URL via `utils/github.ts`.
- Modify: `services/landing/app/routes.ts` — add `home` route with `get` and `post` handlers wired to the controller's actions.
- Create: `services/landing/test/actions/home.controller.test.ts` — direct controller invocation with mocked `fetch`: valid repo redirects, invalid repo returns rendered error page, k8s 503 surfaces as 503, idempotency-key forwarded as header.
- Create: `services/landing/test/actions/done-banner.test.ts` — pure rendering tests: query-string parsing, GitHub URL derivation, embedded-credential stripping.

**Approach:**
- Form is plain HTML `<form method="post" action={routes.home.create.href()}>` — no special Remix component. Browser native, works without JS.
- Suggestion chips (Notion clone, URL shortener, Habit tracker, Internal admin panel) are buttons (also plain HTML); a small `clientEntry` listens to chip clicks and sets the textarea value via direct DOM manipulation. **Chips replace, do not append.** No template selection logic.
- Inert chips (Stack: auto / DB: postgres / Attach 📎) are rendered as disabled buttons with a `title="Coming soon"` attribute.
- Submit button: the `clientEntry` wraps a `<button type="submit">`. On click, set `pending=true`, `handle.update()`, then let the form submit natively. The button shows "Start session" idle, "Starting…" while pending. After the page navigates (controller returns redirect), the new render starts fresh — no manual reset needed.
- Idempotency-key: a hidden `<input type="hidden" name="idempotencyKey" value={crypto.randomUUID()}/>` rendered server-side per page render. The controller forwards it as `Idempotency-Key` header.
- Error path: when the upstream returns non-2xx, the controller `render(<CreatePage error={err}/>, {status: res.status})` so the page rerenders with the same form values plus an inline error.
- Done banner: parses query params, computes the GitHub URL via `branchUrl()`, renders a small `<aside>` above the textarea.

**Patterns to follow:**
- Bookstore demo's `cart-button.tsx` for the `clientEntry` + `handle.update()` pending-state pattern.
- The wireframe's `screens-create.jsx` `CreateFullPage` component (variant B) for layout proportions and copy.
- The installed `author-ui-modules` skill for component conventions.
- The installed `write-tests` skill for `remix/test` controller-test patterns.

**Test scenarios:**
- *Happy path:* `index` action with no query renders Create page with empty textarea + branch="main" default + four suggestion chips.
- *Happy path:* `index` action with `?done=01HABCDEF&repo=https%3A%2F%2Fgithub.com%2Fexample%2Fx&branch=main` renders Done banner above the form.
- *Happy path:* `create` action with valid `{repo, branch, idempotencyKey}` POSTs to upstream `${OPENVOID_API_URL}/sessions`, returns redirect to `/sessions/<sessionId>`. Verifies the `Idempotency-Key` header is included.
- *Edge case:* `create` action with empty repo: schema validation fails, controller re-renders Create page with inline error, status 400.
- *Edge case:* `create` action with non-HTTPS repo: upstream returns 400 `invalid_request`, controller re-renders Create page with the upstream error message.
- *Error path:* `create` action when upstream returns 503: controller renders Create with friendly "API unreachable" banner, status 503.
- *Edge case (Done banner):* `repo` URL has `.git` suffix or trailing slash → link is normalised (`/example/x/tree/feat/<sid>`).
- *Edge case (Done banner):* `repo` URL has embedded credentials (`https://user:pat@github.com/...`) → they are stripped before display.
- *Integration:* idempotency-key field is generated and forwarded; two consecutive POSTs from the same form mount produce the same key (regression for "key regenerates on every render" — should not).

**Verification:**
- All test scenarios pass.
- Manual: dev server running, fill the form, submit; redirect to `/sessions/<id>` (next unit renders it).
- Manual: paste `/?done=…` in the URL bar; banner renders correctly.

---

- [ ] **Unit 4: `/sessions/:id` route — Provisioning + Ready + Kill flow + Failed/Timeout**

**Goal:** The `/sessions/:id` controller renders all post-create states: Provisioning (with cadence-driven polling via Frame), Ready (split-cards), Kill-confirm (small confirm dialog), Kill-in-flight (action-submitting overlay), Failed, Timeout. State transitions are derived from the controller's payload + a small `clientEntry` polling region. Refresh at any state works (controller re-fetches; client state is recomputed).

**Requirements:** R1, R2, R3, R5.

**Dependencies:** Unit 2, Unit 3.

**Files:**
- Create: `services/landing/app/actions/sessions/controller.tsx` — `show` action with retry-on-404 (3×, 200ms backoff); `stop` action (DELETE, redirect to `/?done=…`); `cancel` action (DELETE, redirect to `/`).
- Create: `services/landing/app/actions/sessions/page.tsx` — `SessionPage` component renders one of: `<Provisioning>`, `<Ready>`, `<KillConfirm>`, `<KillInFlight>`, `<Failed>`, `<Timeout>` based on `view.kind`.
- Create: `services/landing/app/actions/api/sessions-status/controller.tsx` — resource controller that returns `Session` JSON. Consumed by the `<Frame>` polling region. Same `getSessionWithRetry` + ingress-readiness gate as the page controller.
- Create: `services/landing/app/actions/sessions/components/{provisioning,ready,kill-confirm,failed,timeout}.tsx` — pure render-fn components per wireframe variants 03-A, 04-A, 06-A (simplified), Failed (composed), Timeout (Provisioning variant with copy override).
- Create: `services/landing/app/actions/sessions/client/status-frame.tsx` — `clientEntry`-wrapped `<Frame>` that polls `handle.reload()` on a `setInterval` driven by `pollCadenceMs(elapsedMs)`.
- Create: `services/landing/app/actions/sessions/client/stop-button.tsx` — `clientEntry` button that opens a small confirm dialog (a `<dialog>` element or absolute-positioned overlay), then submits a hidden form with `intent=stop` to the controller.
- Create: `services/landing/app/actions/sessions/client/cancel-button.tsx` — `clientEntry` button that submits a hidden form with `intent=cancel`.
- Modify: `services/landing/app/routes.ts` — add `sessions` route with `show`, `stop`, `cancel` actions; add `api.sessionsStatus` resource route.
- Create: `services/landing/test/actions/sessions.controller.test.ts` — show action: 200 returns Session, 404 retries 3×, eventually-200 succeeds, eventually-404 returns rendered NotFound page. Stop/cancel actions: DELETE called, correct redirect target.
- Create: `services/landing/test/actions/sessions-status.controller.test.ts` — JSON resource controller: same retry semantics, returns shape consumed by Frame.

**Approach:**
- `show` action retries `getSession` on 404 with 3× / 200ms backoff. After exhaustion, renders a "Session not found — return to start" page with `status: 404`.
- View derivation: `const view = await gateOnIngressReadiness(deriveView(session))`. The ingress-readiness gate fires HEAD probes against `agentUrl + previewUrl` with 3s timeout each. If both succeed → `view` stays `{kind:"ready"}`. If either fails → downgrade to `{kind:"provisioning", pendingPhase:"running-pre-ingress"}` so the polling continues.
- Polling: the page renders a `<Frame src={routes.api.sessionsStatus.href({id})}>`. The `clientEntry`-wrapped polling region (`status-frame.tsx`) holds a `setInterval` that calls `handle.reload()` on the Frame at the cadence returned by `pollCadenceMs(elapsed)`. When the resource controller's response indicates a terminal state (`Ready` or `Failed`), the polling component clears its interval. **The Frame's content re-renders on each reload**; the parent page's main JSX is static (controller-rendered).
- Stop flow: `<StopButton>` opens a confirm dialog. Confirm submits a hidden `<form action="/sessions/:id" method="post">` with `<input name="intent" value="stop"/>`. The `stop` action runs DELETE upstream, then redirects to `/?done=…` with `repo` and `branch` from the pre-delete Session GET. While the action is in flight, the page is in a navigation-pending state (Remix 3 doesn't expose this directly; the `clientEntry` button can flip a local `submitting` flag for visual feedback).
- Cancel flow (Provisioning): `<CancelButton>` is similar but submits `intent=cancel` and the controller redirects to `/` (no banner).
- Failed state: rendered when `view.kind === "failed"`. If `failureReason.message` is present, show it verbatim under the "Provisioning failed" eyebrow. Otherwise show a generic "Couldn't bring up the session" copy. CTA: "Back to start" linking to `/`.
- Timeout state: a Provisioning render with copy overridden ("This is taking longer than usual…") and a more prominent Cancel button. Switches in when the polling component detects elapsed > 90s without status change.

**Patterns to follow:**
- Bookstore demo's `<Frame>` usage for status-region rendering.
- Bookstore demo's `cart-button.tsx` for the `clientEntry` + `on('click', async (e, signal) => …)` async-with-cancellation pattern.
- The installed `author-ui-modules` skill for the multi-state component composition.
- `services/landing/src/app.ts` (current) lines 67–115 for the cadence + ingress-readiness logic — the values transfer; the API names change.
- The wireframe's `screens-provisioning.jsx` variant A, `screens-twolinks.jsx` variant A, `screens-kill.jsx` variants A and B for layout/copy.

**Test scenarios:**
- *Happy path:* `show` action with `Pending` Session renders `<Provisioning>`.
- *Happy path:* `show` action with `Running` + URLs + ingress-probe success renders `<Ready>`.
- *Happy path:* `stop` action posts upstream DELETE, redirects to `/?done=:id&repo=&branch=`.
- *Happy path:* `cancel` action posts upstream DELETE, redirects to `/`.
- *Edge case:* `show` action with first-call 404, second-call 200 → renders normally (retry succeeds).
- *Edge case:* `show` action with all 3 calls 404 → renders NotFound page with status 404.
- *Edge case:* `show` action with `Running` + URLs + ingress-probe failure → renders `<Provisioning>` with `pendingPhase: "running-pre-ingress"`.
- *Edge case:* `show` action with `Failed` + `failureReason.message` → renders `<Failed>` with the reason verbatim.
- *Edge case:* `show` action with `Failed` and no `failureReason` → renders `<Failed>` with generic copy.
- *Error path:* `stop` action when upstream returns 503 → renders Ready with an inline "Couldn't stop, retry?" banner; does not redirect.
- *Error path:* `cancel` action when upstream returns 404 (already gone) → redirects to `/` regardless (graceful handling).
- *Integration:* polling cadence in `status-frame.tsx` — first reload at 1000ms, second at 2000ms, switch to 5s after 30s, 10s after 90s. Test via `t.useFakeTimers()`.
- *Integration:* the deep-link path — refreshing `/sessions/:id` while in Ready state re-renders correctly because the controller refetches.

**Verification:**
- All test scenarios pass.
- Manual end-to-end on kind: form → provisioning visible with steps animating → URLs appear → click Stop → confirm → done banner on `/`.
- Manual: visit `/sessions/<sid>` directly during a session's life — page loads correctly.

---

- [ ] **Unit 5: Multi-stage Dockerfile + Tilt + manifest updates**

**Goal:** A production-shape Dockerfile (3-stage: builder, dev, runtime) on Node 24-alpine replaces the Vite + nginx Dockerfile. The Tilt resource builds the dev image with hot-reload. The `infra/local/landing.yaml` manifest updates port, resource budget, and env-var contract. `OPENVOID_API_URL` becomes the runtime config; build-args are gone.

**Requirements:** R4 (runtime API URL), R6 (chart hook compatibility).

**Dependencies:** Units 1–4.

**Files:**
- Replace: `services/landing/Dockerfile` — new 3-stage shape on `node:24-alpine`. Builder: copy workspace manifests → `pnpm install --frozen-lockfile` → copy sources → `pnpm deploy --prod /opt/landing` (extracts a self-contained tree). Dev stage: extends builder, runs `pnpm exec tsx watch server.ts`. Runtime: copies `/opt/landing` from builder, applies SCC-friendly `chgrp -R 0 /app && chmod -R g=u /app`, `USER node`, `CMD ["pnpm", "exec", "tsx", "server.ts"]`.
- Modify: `Tiltfile` — landing block: change `target="dev"` (already), change port_forward to expose `app/server.ts`'s listen port (3000). Update `live_update` syncs to `services/landing/app/` and `packages/protocol/generated/`. Drop the `build_args={"VITE_OPENVOID_API_URL": ...}` since it's a runtime env var now; instead, set the env var on the K8s manifest.
- Modify: `infra/local/landing.yaml` — Deployment `containerPort: 3000`; Service `targetPort: http`; `resources` updated (`requests: 50m/96Mi, limits: 500m/256Mi`); add `env: [{name: OPENVOID_API_URL, value: "http://session-api.openvoid-system.svc.cluster.local:4000"}, {name: PORT, value: "3000"}]`; `livenessProbe` + `readinessProbe` on `/` (the home controller returns 200 for any matched route).
- Create: `services/landing/.dockerignore` — exclude `node_modules`, `.tsbuildinfo`, `*.log`, `.claude/`, `test/`.
- Modify: `services/landing/package.json` — `start` script: `tsx server.ts`; `dev` script: `tsx watch server.ts`.

**Approach:**
- The runtime stage runs `tsx server.ts` directly — no compile step, no separate bundle. Matches the bookstore demo's pattern. Trade-off: slightly slower cold start than ahead-of-time-compiled JS, but simpler image and matches the framework's "runtime over build steps" principle. If runtime cold-start matters in production, compile to JS in the builder (`tsc --emit`) and run `node dist/server.js` instead. Defer that optimization until profiled.
- `OPENVOID_API_URL` is set on the Deployment env to point at the in-cluster Session API service (`session-api.openvoid-system.svc.cluster.local:4000`). This is **net new** vs Phase 7's setup (which had the landing call the public ingress); going in-cluster is faster, avoids the round-trip through cloudflared on DOKS, and eliminates CORS concerns. The browser still talks to the landing, which talks to the API server-side.
- Tilt `live_update` syncs source files into the running dev container; `tsx watch` picks them up and restarts the server. Lockfile / package.json changes still trigger full rebuilds (intentional).
- The Phase 9 chart's `landing/deployment.yaml` template gets the same env block; the production-readiness plan's Unit 9.1 already lists `landing.{image.repository,image.tag,replicas,host}` — add `landing.containerPort` (3000) and `landing.apiUrl` (default to the in-cluster service URL).

**Patterns to follow:**
- `services/session-api/Dockerfile` (the canonical 3-stage shape for this repo).
- `Tiltfile` lines 22–46 (the session-api block).
- `infra/local/session-api.yaml` (the env-block convention).
- Bookstore demo's `package.json` for the `tsx server.ts` runtime command shape.

**Test scenarios:**
- *Happy path:* `docker build -t localhost:5001/openvoid/landing:dev -f services/landing/Dockerfile --target dev .` succeeds.
- *Happy path:* `docker build --target runtime ...` succeeds and produces a smaller image than the dev stage (no dev deps, no test files).
- *Happy path:* `tilt up` brings the landing pod to Ready; `kubectl logs` shows the Remix 3 server listening on 3000; `curl http://app.127.0.0.1.nip.io/` returns the Create page HTML.
- *Edge case:* `pnpm install --frozen-lockfile` from the builder context fails clearly if the lockfile is stale (typical when adding new deps). Documented in commit message.
- *Edge case:* the dev stage's hot-reload loop survives a source edit (Tilt sync → `tsx watch` restart → browser reload). Manual test.
- *Integration:* `OPENVOID_API_URL` set to a non-existent URL → landing's home page renders the Create form, but POSTing the form returns a 502 with a friendly "API unreachable" inline. (This is the production-equivalent of CORS failures in Phase 7.)
- *Edge case:* readiness probe on `/` succeeds within 5s of pod start (controller renders without hitting upstream). `livenessProbe` continues to succeed even when `OPENVOID_API_URL` is unreachable (the home controller's index path doesn't call upstream).

**Verification:**
- `tilt up` succeeds, end-to-end magic moment works through the new UI.
- Image size: runtime image is reasonable (Node 24-alpine + Remix 3 single-package + tsx; expect ~150–250 MB).
- Image works with both `OPENVOID_API_URL=http://session-api.openvoid-system.svc.cluster.local:4000` and `OPENVOID_API_URL=https://api.<doks-domain>` without rebuild.
- The three Remix dev skills are present in the runtime image (or excluded — verify `.dockerignore` includes `.claude/`).

---

- [ ] **Unit 6: Polish, accessibility, design-fidelity sweep**

**Goal:** Visual fidelity to the wireframes is verified screen-by-screen. Accessibility basics are in place (focus rings, semantic HTML, `aria-live` for status transitions). README documents the package's role and dev story. The package is ready to merge.

**Requirements:** R1, R5 (design quality bar).

**Dependencies:** Units 1–5.

**Files:**
- Modify: `services/landing/app/styles/theme.css` — final-pass token polish; ensure all `wireframe-primitives.jsx` shapes are reproduced.
- Modify: `services/landing/app/ui/*.tsx` and `services/landing/app/actions/**/page.tsx` — accessibility audit (keyboard focus, ARIA labels, visible focus rings, label-for associations on inputs).
- Add to `services/landing/app/actions/sessions/page.tsx`: an `<aria-live="polite">` region near the top of the page that announces phase transitions. Only the announcement string is in the live region; the visual UI updates separately.
- Modify: `services/landing/README.md` — final pass: dev story (`pnpm --filter @openvoid/landing dev`), env-var contract, link to wireframes, beta-version warning, link to RR7 fallback path, list of installed skills with one-line descriptions, "the long-term front-end" framing.
- Optional: `services/landing/test/visual/snapshot.test.tsx` — a small set of snapshot tests for the four screens at default viewport. Treat as a guardrail, not a pixel-perfect gate.

**Approach:**
- Visual sweep: load each route in the browser side-by-side with the wireframe canvas. The user can do this; document the URLs to compare in the README.
- Focus management: on route transition (`/` → `/sessions/:id`), focus moves to the page `<h1>` via a small `clientEntry` that calls `el.focus({ preventScroll: true })` on mount.
- `aria-live` region: a single `<div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>` near the page root, where `statusMessage` is computed from the current view state.
- Color contrast: the warm-off-white + #0A0A0A foreground passes WCAG AA. The `wf-faint` (#A6A39E) is used only for hint copy, not for actionable text — verify in component review.

**Patterns to follow:**
- The wireframe-primitives.jsx component shapes (the source of truth for color/spacing/density).
- The installed `author-ui-modules` skill for component conventions.

**Test scenarios:**
- *Verification — manual:* each of the four screens matches the corresponding wireframe variant on a desktop viewport (1280+).
- *Verification — manual:* keyboard navigation works end-to-end (Tab through the form, focus visible, submit via Enter, navigate to provisioning, Tab to Cancel, etc.).
- *Edge case (a11y):* `aria-live` region announces the right transitions (test via VoiceOver / NVDA spot-check).
- *Edge case:* focus lands on `<h1>` on route transition without scrolling the page.

**Verification:**
- Manual visual diff between rendered routes and wireframes is a close match. Light deviations OK (e.g., margin tweaks for line-length); structural deviations are fixed.
- Lighthouse a11y audit ≥90.
- Final `pnpm --filter @openvoid/landing test` + `pnpm --filter @openvoid/landing typecheck` green.

---

## DO NOT BUILD (carved from the wireframes — descope reminders for the implementer)

The wireframes show several affordances that are explicitly out of scope. Do **not** wire them up, even if the wireframe variant uses them as decoration:

- **Avatar in top bar (`maria` initial chip).** Render statically OR omit. No login/profile.
- **"Back to apps" / dashboard navigation.** No dashboard exists; no link should go there.
- **App name slugs in URLs (`recipe-jar.openvoid.dev`).** Sessions are ULID-addressed; the wireframe URL bar is decorative.
- **"Notify me when ready" / email-when-done.** No email integration.
- **Tip carousels** ("While you wait…").
- **Stack/DB/Attach chips on Create.** Render disabled; do not wire.
- **Multiple session metaphors** ("Session 1 of N"). One active session at a time, addressed by URL only.
- **Commit metadata in Kill confirm** (files changed, commit message preview, +/- line counts). **MVP says "Kill session and save your work?" + body copy. Nothing more.**
- **Live commit log in Kill in-flight** (the wireframe shows ` ✓ staged 14 files / › pushing to origin/main`). API doesn't stream this. Use a spinner + generic copy.
- **Rich Done state** (commit hash, file count, "Publish draft" CTA). MVP says "Saved. View on GitHub →".
- **Publish draft → promote to production flow.** Entirely deferred.

If a wireframe variant has these and you can't tell whether to skip — **skip it** and ask. The implementation should err toward smaller scope.

## System-Wide Impact

- **Interaction graph (post-redesign):** Browser → ingress-nginx → landing pod (Remix 3 server) → in-cluster Session API → K8s API → per-session Pod chain. The browser **never** talks to the Session API directly; this is a meaningful shape change vs Phase 7. Two consequences: (a) CORS becomes a non-issue (bonus: removes the Phase 7 CORS-misconfig brittleness), (b) the landing pod needs in-cluster network access to `session-api.openvoid-system.svc.cluster.local:4000`, which is fine on default cluster networking (no NetworkPolicy gates v1's `openvoid-system` namespace).
- **Error propagation:**
  - Session API 4xx → controller surfaces friendly inline error (form-with-error or page-error-banner).
  - Session API 5xx → controller renders an error page with status 502 and a friendly "API unreachable" message.
  - Network failures during polling → visible in a small "reconnecting…" indicator, polling continues with backoff. After multiple failures, a manual Retry CTA appears.
  - Init-container failures → surface via `failureReason` field if API exposes it; otherwise generic Failed copy.
- **State lifecycle risks:**
  - **Read-after-write window:** mitigated by the controller's 3× retry on 404. Documented Open Question.
  - **Ingress not yet programmed:** mitigated by the controller's HEAD probes before transitioning to Ready. Production-readiness Phase 9 should ideally push this server-side.
  - **Done banner stale on refresh:** `/?done=…` re-renders the banner forever. Acceptable; clearing requires a manual reload to `/`.
  - **Orphan pods on cancellation:** Cancel during Provisioning issues DELETE explicitly. Ready→Stop also issues DELETE. Both reach the API; orphan only happens if the user closes the tab during Provisioning without clicking Cancel — that's the same hazard as Phase 7 and is bounded by `activeDeadlineSeconds=4h`.
- **API surface parity:** none of this plan modifies the Session API. The redesign consumes the existing 3-endpoint contract. Two suggested API enhancements (idempotency-key enforcement, `failureReason` field) are flagged as Open Questions but not blocking.
- **Integration coverage:** the "manual end-to-end on kind" run during Unit 5 is the integration test for v1. Playwright e2e is deferred (matches Phase 7's stance and the bookstore demo's posture — Playwright is wired up in the demo but not run in CI).
- **Unchanged invariants:** Session API HTTP contract, K8s resource lifecycle (Pod + Service + 2 Ingresses with ownerReferences cascade), session-ID-as-credential threat model, all intact.
- **Test infrastructure divergence:** the landing uses `remix/test` while the rest of the repo uses vitest. Documented; CI handles both runners. The session-api and protocol packages are unchanged.
- **Per-service Node version:** repo root engines stay at Node ≥20; landing requires ≥24.3. CI matrix and Tilt honour the per-package floor. No global Node bump.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| **Remix 3 beta API churn** (rename / removal between releases) | Pin to `3.0.0-beta.0` exactly. Review changelog + bookstore demo diff before each bump. Budget 1 day per bump for refactoring. Documented fallback to RR7 if churn exceeds the budget. |
| **Documentation gaps** (no comprehensive docs site) | Bookstore demo is the canonical reference, linked per-unit. The three installed skills capture framework idioms inline. README points contributors to the right places. |
| **No React component library compatibility** | Custom primitives only; the wireframe primitives port directly. No external React UI library is in scope for the four screens. Document the limitation if a future need surfaces. |
| **Polling pattern (`<Frame>` + `handle.reload()`) not yet documented** | Validate against bookstore demo's source on each beta bump. Test the polling cadence with `remix/test`'s `useFakeTimers`. Worst case: fall back to a `setInterval` + manual `fetch` inside the `clientEntry` (less idiomatic but works). |
| **Test framework divergence** (`remix/test` vs vitest) | Documented in `services/landing/README.md`. CI runs both. The two runners do not interfere; the divergence is contained to the landing package. |
| **Node 24 floor for landing only** | Per-service `engines.node`. Tilt + Dockerfile use `node:24-alpine` for landing only; session-api stays on Node 20. CI matrix targets the per-package floor. |
| **Polling rate accidentally hammering the API** | `pollCadenceMs` is a pure function with explicit thresholds; tested directly. The Ready state stops polling entirely. |
| **Loader 404 retry loop during real outages** | 3× retry × 200ms = 600ms total; bounded. After that, NotFound page renders. |
| **Ingress HEAD probe causes upstream load on the per-session pod** | Each probe is one HEAD request, no body. Probes only fire when the controller sees Running with URLs (a minimal window). |
| **`OPENVOID_API_URL` mis-set in production** | Controller's first call returns 502 with a clear message. The error page surfaces "API unreachable, contact support." Operator-side issue, not user-facing bug. |
| **Visual fidelity drifts from wireframes during port** | Unit 6 has an explicit visual-sweep verification step. Design tokens transfer to CSS variables (mechanical port) so drift is bounded to spacing/layout. |
| **Lockfile diff is large** (single `remix` package, but pulls a Preact-vendor tree) | Smaller than RR7's `react`+`react-dom`+RR7 packages combined. Single-commit lockfile addition; reviewers focus on the top-level deps. |
| **Production-readiness Phase 9 chart templates assume the throwaway landing's port (80)** | Add `landing.containerPort` value (default 3000 once this plan ships). Production-readiness plan Unit 9.1 should add this; flag in coordination notes. |
| **Session API doesn't enforce Idempotency-Key header today** | UI-side `clientEntry` pending-state guard catches the typical fast-double-click case; the header is best-effort defense in depth. File API ticket; not blocking. |
| **Remix 3 GA slips past Q3 2026** | Documented [Migration / Fallback Path](#migration--fallback-path) to RR7. Visual + UX assets are framework-neutral and survive the migration. |
| **`tsx`-runtime cold start is slower than compiled-JS cold start** | Acceptable for v1 (single replica, infrequent restarts). Profile in Phase 9; optimize to compiled JS if cold start becomes a real complaint. |

## Documentation / Operational Notes

- **README update.** `services/landing/README.md` becomes the canonical "this is the long-term openvoid front end" doc. Drops the "intentionally short-lived" framing. Adds a beta-version warning and a "how to bump Remix 3" subsection.
- **Companion plan note.** Add a one-line update to `docs/plans/2026-05-05-001-feat-v1-production-readiness-plan.md` Phase 9.1's `landing.*` value list: `landing.containerPort` (default 3000 once this plan ships) + `landing.apiUrl` (default to the in-cluster service URL). Cross-link explicitly.
- **Memory file update.** The `services/landing is throwaway` memory entry becomes stale once this plan ships. Update or remove it after Unit 6 closes.
- **Skill discoverability.** Document the three installed skills in `services/landing/README.md` with one-line descriptions and links to `.claude/skills/<name>/SKILL.md`. Anyone using Claude Code in the repo can invoke them directly.
- **`/ce:compound` candidates.** After this plan ships, consider compound entries for: Remix-3 polling pattern, runtime env-var injection in Node servers, design-token CSS-variable theming, vanilla-to-Remix-3 component porting, beta-version-pin discipline. Most are universal patterns this codebase will reuse if the framework bet pays off.
- **Tilt URLs reminder.** Local dev: `http://app.127.0.0.1.nip.io/`. The Tilt UI shows the running landing pod; port-forward at the chosen local port (e.g., 8088) for direct dev hits. Update the README's "Local dev" snippet.

## Sources & References

- **Companion plan (production readiness):** [docs/plans/2026-05-05-001-feat-v1-production-readiness-plan.md](2026-05-05-001-feat-v1-production-readiness-plan.md). Specifically the "Coordination with the Landing Page Redesign Plan" section.
- **Parent plan (history + foundation):** [docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md](2026-05-01-001-feat-v1-staged-walkthrough-plan.md). Phase 7 implementation units describe what's being replaced.
- **Phase 7 ce:review residuals:** [docs/plans/2026-05-05-001-feat-v1-production-readiness-plan.md](2026-05-05-001-feat-v1-production-readiness-plan.md) "Carry-overs from Phase 7 — Residuals".
- **Helm routing abstraction (Known Pattern):** [docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md](../solutions/best-practices/helm-routing-abstraction-2026-05-03.md).
- **Wireframe bundle:** Claude Design handoff at `/tmp/openvoid-design/openvoid/`. Primary file `project/OpenVoid Wireframes.html` (canvas), `project/screens-{create,provisioning,twolinks,kill}.jsx` (in-scope screen variants), `project/wireframe-primitives.jsx` (design tokens), `chats/chat1.md` (the design conversation — the de facto requirements artifact).
- **Remix 3 — Beta Preview blog (2026-04-29):** https://remix.run/blog/remix-3-beta-preview
- **Remix 3 source repo:** https://github.com/remix-run/remix
- **Bookstore demo (canonical worked example):** https://github.com/remix-run/remix/tree/main/demos/bookstore
- **`packages/ui` README:** https://github.com/remix-run/remix/blob/main/packages/ui/README.md
- **`packages/fetch-router` README:** https://github.com/remix-run/remix/blob/main/packages/fetch-router/README.md
- **Wake up, Remix! announcement:** https://remix.run/blog/wake-up-remix
- **Community resource hub:** https://github.com/markdalgleish/remix3-resources
- **Examples repo:** https://github.com/sergiodxa/remix-v3-examples
- **Remix dev skills (installed under `.claude/skills/`):**
  - https://github.com/remix-run/remix/blob/main/.agents/skills/expert-typescript-programmer/SKILL.md
  - https://github.com/remix-run/remix/blob/main/.agents/skills/write-tests/SKILL.md
  - https://github.com/remix-run/remix/blob/main/.agents/skills/author-ui-modules/SKILL.md
