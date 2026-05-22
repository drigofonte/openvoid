---
title: "Scaffold: react-rr7-minimum"
type: scaffold
status: v1
date: 2026-05-19
repo: openvoid-platform/scaffold-react-rr7
---

# react-rr7-minimum

The canonical "blank app" the new-app entry point seeds every per-app
repo from. Vite + React Router v7 in framework mode, TypeScript,
genuinely minimum — no shadcn, no theme provider, no auth, no
layout/shell primitives. The intent is that the agent grows the app
from this baseline rather than starting by replacing it.

This document is the **specification** of what
`openvoid-platform/scaffold-react-rr7` (the external repo on the
platform GitHub org) contains. The scaffold itself is an artifact under
operator control — versioned, can be updated; updates do not retroactively
touch existing app repos.

The workspace-init container (`infra/images/workspace-init/`, U7):
clones this repo with anonymous HTTPS, strips its history, reinitialises
git against the newly-created per-app repo, overwrites
`app/scaffold-meta.json` with the user's prompt, commits, and pushes
`main` using the platform PAT — then runs `pnpm install` and exits.

## Repository layout

```
package.json
pnpm-lock.yaml
tsconfig.json
react-router.config.ts
vite.config.ts
README.md
app/
  root.tsx
  scaffold-meta.json
  routes/
    _index.tsx
```

No `src/`, no `public/` (RR7 framework mode keeps assets under
`app/`), no test harness in v1 (the agent introduces tests as the app
grows), no Tailwind / shadcn / CSS framework.

## File contracts

### `package.json`

| Aspect | Value |
|---|---|
| **Package manager** | pnpm (the workspace-init container ships pnpm 9). |
| **Runtime deps** | `react`, `react-dom`, `react-router` (v7, framework mode). |
| **Dev deps** | `vite`, `@vitejs/plugin-react`, `typescript`, `@react-router/dev`, `@react-router/node`, type packages. |
| **Scripts** | `dev` runs Vite on port 3000 bound to `0.0.0.0` (port-3000 readiness probe in U8 targets this). `build` and `start` exist but v1 only exercises `dev`. |
| **Name** | Whatever the per-app repo is called; the scaffold template ships with `name: "scaffold-react-rr7"` and the agent renames as it customises. |

### `pnpm-lock.yaml`

Committed. The workspace-init container runs `pnpm install --frozen-lockfile`
so a lockfile is required.

### `vite.config.ts`

```ts
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    // v1 trade-off: any Host header is allowed. The preview ingress
    // routes <sid>.preview.<domain-base> here; the agent is inside the
    // pod's network and that is the only public path in. Tightening
    // to a per-session host allowlist is tracked at the v1-plan level
    // (see the May-01 plan's allowedHosts concern). Do not remove this
    // line in v1 — Vite's host-check would otherwise 403 the first
    // request.
    allowedHosts: true,
  },
});
```

The `0.0.0.0` bind matters: the readiness probe targets the agent
container's loopback `localhost:3000`, and the per-session Service
forwards external traffic to the same port. Without `host: "0.0.0.0"`
Vite defaults to localhost-only inside the pod, the Service has no
endpoint to forward to, and the preview ingress 502s.

### `app/root.tsx`

The RR7 framework-mode root. Renders the HTML shell + `<Outlet />`.
No global layout, no provider tree, no styling. Intentionally bland:
the agent expands this when it introduces theme / nav / etc.

### `app/routes/_index.tsx`

The empty-state index route. Imports `~/scaffold-meta.json` and
surfaces the prompt the user typed on landing:

- If `meta.prompt` is non-empty: render `<h1>Building: {meta.prompt}</h1>`
  with a short subtitle inviting the user to talk to the agent.
- If `meta.prompt` is empty (no-prompt new-app fallback): render a
  generic "Your new app — talk to the agent to build it" treatment.

The visual treatment is settled during U3 by iterating the scaffold
repo's `app/routes/_index.tsx` directly. The contract this document
fixes is: the route MUST read `app/scaffold-meta.json` and MUST
surface the prompt in a way the user recognises as "their input was
heard". No nav, no shell, no other routes.

### `app/scaffold-meta.json`

The committed placeholder ships as:

```json
{
  "prompt": "",
  "createdAt": "",
  "scaffoldVersion": "v1"
}
```

The workspace-init container overwrites this file at seed time (U7)
with the real values:

| Field | Type | Source | Notes |
|---|---|---|---|
| `prompt` | `string` | landing form `prompt` field, forwarded by Session API | May be empty if user submitted with no prompt. The empty-state route handles that. |
| `createdAt` | `string` (RFC 3339) | `$(date -Iseconds)` inside workspace-init | Recorded at seed time, not session-create time. The two are within a few seconds in practice. |
| `scaffoldVersion` | `string` | hard-coded in workspace-init | Lets future versions of the scaffold ship without retroactively breaking apps generated against earlier versions. Bumps when the file shape evolves. |

The file is a regular committed artifact in each per-app repo — the
agent CAN modify it (e.g. to clear the prompt once the app has moved
past the empty state). v1 makes no claims about read-only-ness.

Placeholder shape is committed because the workspace-init seed step is
an edit-and-commit, not a create-and-commit; a pre-existing file
keeps the seed step trivial (`jq`/`printf` write, `git add -A`,
commit).

### `README.md`

Minimum-viable: one section on the layout, one section on running
locally (`pnpm install && pnpm dev`), and one **explicit "Agent
guidance" section** with the soft "extend, don't rebuild" constraint.
The same wording lives in `infra/images/opencode/instructions/scaffold-extend.md`
(U7 in this monorepo) — belt-and-suspenders given the unverified
question of whether OpenCode reliably reads `README.md` as context.

Suggested wording (refine empirically once the scaffold is exercised
end-to-end):

> ## Agent guidance
>
> This repo was seeded from a minimum React Router v7 scaffold. When
> the user asks you to build their app, **extend this scaffold rather
> than rebuilding it from scratch**:
>
> - `app/routes/_index.tsx` is the starting canvas — replace or
>   augment its content rather than introducing a parallel index.
> - `app/scaffold-meta.json` holds the user's original prompt under
>   the `prompt` key; it's safe to read or update.
> - Add new routes as files under `app/routes/`, following the RR7
>   framework-mode convention.
> - Pull in styling, UI libraries, and infrastructure as the user's
>   requests warrant — the scaffold deliberately ships without them.

### `tsconfig.json` and `react-router.config.ts`

RR7 framework-mode defaults. No custom path aliases beyond `~` →
`app/`. The scaffold's pnpm-lock pins the RR7 versions the
`react-router.config.ts` shape assumes.

## Versioning

`scaffoldVersion: "v1"` in `app/scaffold-meta.json` tracks the file
shape and contract documented here. Bumps to `v2` happen when:

- The metadata file's field set or types change.
- The directory layout's load-bearing files move (e.g. RR7 changes the
  `app/` convention).
- The agent-guidance contract changes in a way that prior per-app repos
  can't interpret.

Cosmetic scaffold edits (dependency bumps, prettier visual treatment
of the empty-state route, README wording) do not bump the version.

## Operator validation

The scaffold is correct when:

1. `git clone https://github.com/openvoid-platform/scaffold-react-rr7.git`
   succeeds anonymously (the repo is public — workspace-init clones
   without credentials).
2. `cd scaffold-react-rr7 && pnpm install && pnpm dev` brings up Vite
   on `http://localhost:3000/` serving the empty-state route.
3. The file structure on disk matches the layout documented above.
4. `app/scaffold-meta.json` parses as JSON with the three documented
   fields.
5. The README contains the "Agent guidance" section verbatim against
   the wording shipped in `infra/images/opencode/instructions/scaffold-extend.md`.

End-to-end validation happens during U7 manual smoke (workspace-init
seeds a real new-app session from this scaffold and pushes the result
to a per-app repo on the org).
