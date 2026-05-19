# Scaffold-extend guidance

**When the user asks you to build their app, extend the scaffold rather
than rebuild it.**

This session was seeded from the canonical openvoid scaffold (Vite +
React Router v7 framework mode, TypeScript, deliberately minimum). The
contents of `/workspace/repo` are not boilerplate to clear away — they
are the starting canvas the user expects you to grow.

## What's already here

| File | Role |
|---|---|
| `app/root.tsx` | RR7 framework-mode root with `<Outlet />`. Plain HTML shell, no styling system. Add a layout / theme / nav by extending this file. |
| `app/routes/_index.tsx` | The empty-state index route. Reads `~/scaffold-meta.json` and surfaces the user's prompt. Treat this as the starting canvas — replace or augment its content as the user describes what they want. |
| `app/scaffold-meta.json` | `{ prompt, createdAt, scaffoldVersion }`. The `prompt` field is the free-form description the user typed on landing; you can read it for context or update it as the app's identity evolves. |
| `package.json` | `react`, `react-dom`, `react-router` (v7), TypeScript, Vite. Nothing else — add libraries (Tailwind, shadcn, state managers, auth, …) as the user's requests warrant. |
| `vite.config.ts` | Binds `0.0.0.0:3000` with `allowedHosts: true` (per-session preview-ingress trade-off). Do not change these unless you understand the cluster routing. |
| `README.md` | Operator-facing notes plus a copy of this guidance — kept in sync deliberately. |

## How to extend

- **Add new routes** as files under `app/routes/` (RR7 framework-mode
  convention: filename-based routing).
- **Add styling, components, libraries** as needed. The scaffold ships
  unopinionated on purpose; pick the tools that fit what the user
  asked for.
- **Update `app/scaffold-meta.json`** if the user's intent diverges
  from the original prompt (e.g. the prompt said "todo list" but
  conversation has settled on "recipe planner"). The metadata is a
  read/write file, not an immutable seed.

## What NOT to do

- Don't `rm -rf` and restart from scratch. The seed commit is the
  baseline; subsequent commits on `main` extend it.
- Don't replace React Router or Vite with a different framework — the
  preview ingress routes to port 3000 and assumes Vite-shaped
  behaviour (HMR, `allowedHosts`, `0.0.0.0` bind). A swap would break
  the live-preview lifecycle the user is watching.
- Don't introduce a sidecar dev server or alternate port. The pod's
  readinessProbe targets `:3000` (the existing `pnpm dev`); a parallel
  server elsewhere doesn't get probed and won't gate the session's
  Ready state.

## Why this rule exists

The new-app entry point sells the user a "your sandbox is starting" →
"Open preview" experience. If you rebuild from scratch, the dev
server restarts mid-flow, the preview tab 502s while the new server
boots, and the storyboard's promise breaks. Extending preserves
continuity.
