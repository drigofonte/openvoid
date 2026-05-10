# @openvoid/landing

The openvoid landing page — a [Remix 3](https://remix.run) (beta) app
that drives the [Session API](../session-api). Implements the
wireframe-faithful UX from the Claude Design bundle: prompt-first
Create screen, polling Provisioning state, two-tab Ready handoff,
confirm-driven Kill flow with a "Saved → GitHub" recap.

The earlier vanilla-TS landing was an explicit Phase 7 stop-gap. This
package replaces it as the **long-term front-end**, tracking the
landing-redesign plan at
[`docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md`](../../docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md).

## ⚠️ Beta-grade dependency

This package pins `remix@3.0.0-beta.0`. Remix 3 reached public beta
on **2026-04-29**; APIs renamed within the release week. We pin
exactly (no `^`) and budget bumps deliberately. If GA slips past
**2026-09-30** the project's [migration / fallback path](../../docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md#migration--fallback-path)
documents how to fall back to React Router 7 — visual + UX assets
survive the migration.

When upgrading the pin: re-read the
[bookstore demo](https://github.com/remix-run/remix/tree/main/demos/bookstore)
source for the target version, diff against the pinned SHA in
`scripts/sync-remix-skills.sh`, and budget ~1 day for refactoring
import paths and component shapes.

## Local dev

```sh
# From the repo root, after a successful pnpm install:
pnpm --filter @openvoid/landing dev
```

The dev server listens on http://localhost:3000/. `tsx watch`
reloads on source changes.

To talk to a real Session API, set `OPENVOID_API_URL`:

```sh
OPENVOID_API_URL=http://localhost:4000 \
  pnpm --filter @openvoid/landing dev
```

In the kind cluster (`tilt up`), this is set on the Deployment to
`http://session-api.openvoid-system.svc.cluster.local:4000`. The
browser hits the landing pod through ingress-nginx at
`http://app.127.0.0.1.nip.io/`; the landing then proxies API calls
server-side. No CORS in the loop.

### Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `OPENVOID_API_URL` | Yes (in production) | unset | Base URL for the Session API. Server-side controllers will fail if unset. |
| `PORT` | No | `3000` | Port the Node server listens on. |
| `LANDING_SKIP_INGRESS_PROBE` | No | unset | Set to `"true"` in K8s to bypass the per-render HEAD probe of the agent URL. The probe's host (`<sid>.agent.127.0.0.1.nip.io`) resolves to the pod's own loopback in-cluster, so the gate always fails there; trust the API's `Running` + populated URLs instead. Local dev (`pnpm dev` on host) leaves this unset — `127.0.0.1.nip.io` resolves correctly via the host. See [`app/utils/ingress.ts`](app/utils/ingress.ts) for full context. |

## Stack

| Concern | Choice |
|---|---|
| Framework | Remix 3 (beta), framework mode |
| Language | TypeScript 5.7, strict, ESM, JSX via `remix/ui` |
| Server | Built-in Node `http.createServer` + `createRequestListener` |
| Bundler | None — runs `tsx server.ts` directly |
| Styling | Plain CSS + design tokens lifted from the wireframe primitives. See [Styling Architecture](../../docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md#styling-architecture) for the rejected alternatives (Tailwind, shadcn/ui, `createTheme()`). |
| Tests | `remix/test` (Node native test-runner shape), not vitest |
| Node | ≥ 24.3.0 (the package's own engines floor; the repo root stays at ≥ 20) |

## Layout

```
services/landing/
├── app/
│   ├── actions/<route>/
│   │   ├── controller.tsx     # server-side handlers; render(<Page/>)
│   │   └── page.tsx           # JSX render-fn component
│   ├── ui/                    # primitives (Card, Button, Chip, …)
│   ├── render.tsx             # renderToStream → HTMLResponse helper
│   ├── routes.ts              # typed route table
│   └── router.ts              # createRouter() + middleware
├── public/styles/             # CUBE-layered CSS (utopia → tokens → base → composition → blocks → exceptions)
│   ├── utopia.css             # substrate — Utopia fluid type/space scales
│   ├── tokens.css             # substrate — OpenVoid semantic tokens + wf-* aliases
│   ├── base.css               # element resets, body bg, typography
│   ├── composition.css        # CUBE Composition layer (Every Layout primitives)
│   ├── blocks.css             # CUBE Block layer (.wf-* component classes + animations)
│   └── exceptions.css         # CUBE Exception layer (data-attribute variants)
├── server.ts                  # http server bootstrap
├── package.json
└── tsconfig.json
```

## Installed Claude Code skill

The upstream Remix `remix` skill is committed at the repo root's
`.claude/skills/remix/` so any contributor with Claude Code has
framework-shaped guidance available. Run
`bash scripts/sync-remix-skills.sh` from the repo root to refresh it
(the script pins to a specific upstream SHA — bumps are deliberate).

The skill is the canonical "build a Remix 3 app" reference shipped by
the framework team at `template/.agents/skills/remix/` in
`remix-run/remix`. It contains:

- `SKILL.md` — the entry-point with classification rules and a table
  pointing at the right deep-dive reference for the task at hand.
- `references/` — 11 deep-dive files covering routing & controllers,
  middleware & server, assets & browser modules, data & validation,
  auth & sessions, the component model, mixins / styling / events,
  hydration & frames & navigation, animation, and testing patterns.

When working in this package — invoke the skill (`/skill remix`) and
let the SKILL.md classify the task before reading deeper references.
Loading more than two or three reference files at once is a sign the
task hasn't been narrowed enough yet.
