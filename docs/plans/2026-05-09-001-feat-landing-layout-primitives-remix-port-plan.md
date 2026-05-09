---
title: "feat: Port Every Layout primitives from React to Remix 3"
type: feat
status: completed
date: 2026-05-09
---

# feat: Port Every Layout primitives from React to Remix 3

## Summary

Convert eight Every-Layout-style React components imported into `services/landing/app/ui/layout/` (Cluster, Cover, Frame, Grid, Reel, Sidebar, Stack, Switcher) into Remix 3 idioms: drop React-only APIs (`useId`, `useEffect`, `Children.toArray`/`Children.map`, `style={...}`, `HTMLAttributes`) in favor of Remix's `mix={css(...)}`, HTML attribute names, and explicit slot props. Wire the co-located `composition.css` into the document `<head>` so the class definitions reach the browser, and resolve `Switcher`'s per-instance dynamic `limit` via a server-rendered inline `<style>` block. Result: a set of layout primitives the rest of `services/landing` can drop in without React-compat surprises.

---

## Problem Frame

Eight React components landed in `services/landing/app/ui/layout/` to give the landing app reusable composition primitives (Stack, Cluster, Cover, etc.) on top of the existing wireframe primitives. They cannot be used as-is: they import from `"react"`, use `Children.*` APIs that don't exist in Remix 3's renderer, set inline styles via `style={...}` (Remix 3's idiom is `mix={css(...)}`), and use `className` plus a `& Omit<HTMLAttributes<HTMLDivElement>, "className">` rest spread that depends on React's DOM types. Switcher additionally relies on `useEffect` to inject a per-instance `<style>` element — a client-side pattern that doesn't fit the SSR-first Remix 3 model. The matching CSS exists in `composition.css` (co-located in the same folder) but is unreachable from the browser today: the static-files middleware only serves from `public/`, and the asset server compiles JS/TS, not CSS. Without this conversion, the imported components are dead code and the redesign cannot lean on them for layout work.

---

## Requirements

- R1. All eight layout components compile under `services/landing`'s Remix 3 type-check (`pnpm typecheck`) without React-only imports or types.
- R2. Each component renders as SSR HTML with the correct CSS class on the root `<div>` (`.stack`, `.cluster`, `.cover`, `.frame`, `.grid`, `.reel`, `.sidebar`, `.switcher`) plus any variant class the props request (`.stack-recursive`, `.sidebar-right`, `.reel-no-bar`).
- R3. Each component sets the CSS custom properties expected by `composition.css` on the root element (`--space`, `--justify`, `--align`, `--min-height`, `--padding`, `--ratio`, `--grid-min`, `--item-width`, `--reel-height`, `--side-width`, `--content-min`, `--threshold`).
- R4. The CSS rules in `app/ui/layout/composition.css` are delivered to the browser on every HTML response served by the landing app.
- R5. Stack supports the "split at boundary" behavior without React's `Children.toArray` (consumer tags a child with `class="stack-split"`).
- R6. Cover supports the "centered first child" behavior without React's `Children.map` (component takes an explicit `centered` slot prop and wraps it in `<div class="cover-centered">`).
- R7. Switcher supports a per-instance numeric `limit` without `useEffect` or `useId` (component emits an SSR-only sibling `<style>` block with a `:nth-last-child(n+limit+1)` rule, scoped to a unique class).
- R8. The aspect-ratio component does not collide with `remix/ui`'s exported `Frame` symbol when both are imported in the same file.
- R9. Each feature-bearing primitive has a SSR test (`renderToString` from `remix/ui/server`) asserting the emitted class names, CSS variables, and slot wrapping.

---

## Scope Boundaries

- Wiring these primitives into existing pages (`actions/home/page.tsx`, `actions/sessions/page.tsx`, `done-banner.tsx`) is out of scope — adopt them in follow-up redesign work.
- Refactoring or replacing the existing wireframe primitives (`card.tsx`, `button.tsx`, `chip.tsx`, etc.) is out of scope.
- The unused `.box`, `.center`, and `.flow` rules already present in `composition.css` ship with the file but no React component is converted to use them in this plan.
- Generalizing the per-instance inline-style pattern into a shared utility (e.g., a `useScopedStyle` helper) is out of scope; Switcher is the only primitive that needs it today.

### Deferred to Follow-Up Work

- Adopt these primitives in the existing landing pages: separate PR after this lands.
- Add `Box`, `Center`, `Flow` Remix components to match the unused composition.css rules: deferred until a page actually needs them.

---

## Context & Research

### Relevant Code and Patterns

- `services/landing/app/ui/layout/*.tsx` — the eight imported React components being converted.
- `services/landing/app/ui/layout/composition.css` — the co-located CSS the components rely on; defines `.stack`, `.cluster`, `.cover` (+ `.cover-centered`), `.frame`, `.grid`, `.reel` (+ `.reel-no-bar`), `.sidebar` (+ `.sidebar-right`), `.switcher`, `.stack-recursive`, `.stack-split`, plus extras (`.box`, `.center`, `.flow`).
- `services/landing/app/ui/document.tsx` — the HTML shell. Currently links `/styles/base.css` and `/styles/theme.css` from `<head>`; the new inline `<style>` block goes here.
- `services/landing/app/ui/card.tsx`, `button.tsx`, `chip.tsx` — canonical Remix 3 component shape in this repo: `function Card() { return ({ ...props }: CardProps) => (<jsx />) }`, uses `class` (not `className`), `mix={css({...})}` (not `style={...}`), `RemixNode` (not `ReactNode`).
- `services/landing/app/ui/avatar.tsx`, `progress-track.tsx` — additional examples of `mix={css(...)}` for dynamic style values, including CSS custom properties.
- `services/landing/app/ui/input.tsx` — example of branching on a discriminated literal at the call site (relevant: shows the "narrow API to specific props" pattern this plan follows).
- `services/landing/test/actions/done-banner.test.tsx` — canonical SSR-test pattern: `renderToString` from `remix/ui/server`, regex-asserting on emitted HTML.

### Institutional Learnings

- `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` — Remix 3's SSR renderer lowercases unknown camelCase props verbatim. The safe-list is `aria-*`, `data-*`, `className`, `htmlFor`, `tabIndex`, `acceptCharset`, `httpEquiv`. Any other camelCase HTML attribute (including `defaultValue`, `crossOrigin`, `autoFocus`) silently breaks. Implication for this plan: CSS variables go through `mix={css({'--space': ...})}` (translated to a generated class), not `style={{'--space': ...}}` (would be lowercased and silently work, but inconsistent with the codebase). Component prop APIs may keep camelCase (`sideWidth`, `noPad`); the leaf attributes must match the safe-list.
- The existing landing redesign plan (`docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md`) commits to plain CSS over `createTheme()` until repeated overrides justify the upgrade. Composition.css fits that posture: a flat CSS file the document inlines.

### External References

- Every Layout (https://every-layout.dev/) — the design source for these primitives. Notable: the Stack-with-split, Cover-with-centered, and Switcher-with-limit features each rely on per-instance CSS that React handled via `Children.*` and `useEffect`. The plan's Remix-side rewrites pick the Every-Layout-recommended CSS shapes and lift the per-instance state out of the component body where possible.
- Remix 3 `@remix-run/ui` source (`node_modules/.pnpm/node_modules/@remix-run/ui`) — confirms `Frame` is exported from `remix/ui` (a streaming-content primitive); confirmed source of the name collision motivating the rename to `AspectFrame`.

---

## Key Technical Decisions

- **Inline `composition.css` into the document `<head>` via `fs.readFileSync` at module load in `document.tsx`.** The file is co-located with the components (the user's stated preference); the static-files middleware doesn't see `app/`, and the asset server only handles JS/TS. Inlining ships ~4 KB extra in every HTML response but eliminates a render-blocking round-trip and avoids new routes or middleware. Revisit triggers documented in a comment at the read site: total inlined CSS > ~10–15 KB, addition of a 2nd or 3rd co-located CSS file, or introduction of a real CSS build step.
- **Switcher emits a per-instance inline `<style>` block scoped by a module-counter-generated class.** No `useId` (Remix 3 doesn't expose one), no `useEffect` (we don't need client-side mutation when SSR can render the rule directly). The counter lives in the `switcher.tsx` module scope; Remix 3's component factory pattern (`function Switcher() { return (props) => ... }`) gives one outer-call per instance, perfect for capturing a stable per-instance ID. When `limit` matches the default, the component skips the `<style>` emission entirely (the base `.switcher` rule in composition.css is enough).
- **Rename `Frame.tsx` → `aspect-frame.tsx` exporting `<AspectFrame>`.** `remix/ui` already exports a `Frame` (streaming-content primitive); collision in import lists is a foot-gun. Class name in CSS stays `.frame` because composition.css already uses it and the rename is an API-level concern only.
- **Drop React-style `Children.*` introspection in favor of explicit slot props or consumer-tagged classes.** Stack drops the `splitAfter` numeric prop; consumers wrap any single child in `<div class="stack-split">…</div>` to mark the boundary (composition.css's `.stack-split { margin-block-end: auto }` does the rest). Cover takes an explicit `centered: RemixNode` prop wrapped server-side in `<div class="cover-centered">`; remaining `children` render after it. This eliminates the React-only iteration helpers and makes the contract more explicit at the call site.
- **Narrow each component's prop API; drop the `& Omit<HTMLAttributes<HTMLDivElement>, "className">` rest spread.** React's DOM types aren't part of `remix/ui` and the rest-spread pattern leaks attribute pass-through that this codebase doesn't use anywhere else (`card.tsx`, `button.tsx`, `chip.tsx` all narrow to specific props). Each converted component keeps its layout-specific props plus optional `id` and `children`. Callers needing arbitrary inline style overrides can wrap with their own `mix={css(...)}` at the call site.
- **Filenames migrate to kebab-case** (`stack.tsx`, `cluster.tsx`, `cover.tsx`, `aspect-frame.tsx`, `grid.tsx`, `reel.tsx`, `sidebar.tsx`, `switcher.tsx`) to match the project's existing convention (`card.tsx`, `button.tsx`, `chip.tsx`, `top-bar.tsx`). Component identifiers stay PascalCase (`Stack`, `Cluster`, …, `AspectFrame`).
- **CSS variables go through `mix={css({...})}`, not `style={{...}}`.** Consistent with `progress-track.tsx`, `avatar.tsx`, `top-bar.tsx`. The `css()` helper accepts arbitrary string keys (verified in `@remix-run/ui/dist/style/style.d.ts`'s `CSSProps` extension `[key: string]: ...`), so `--space`, `--threshold`, etc. are valid keys.
- **Tests use `renderToString` from `remix/ui/server`** (matching `done-banner.test.tsx`). Each component gets a focused SSR test asserting class membership, CSS-variable presence, and slot wrapping where applicable. No client-side hydration tests — none of these primitives need clientEntry.

---

## Open Questions

### Resolved During Planning

- Where does composition.css live? — Stays co-located in `app/ui/layout/`. Delivered by inlining at SSR time.
- How is Switcher's dynamic limit handled? — Per-instance inline `<style>` with a module-scoped counter for class IDs.
- Frame name collision? — Rename to `aspect-frame.tsx` / `<AspectFrame>`.
- Replacement for `Children.toArray` (Stack) / `Children.map` (Cover)? — Switch to explicit slot props (`Cover.centered`) and consumer-tagged classes (`stack-split`).

### Deferred to Implementation

- Whether the module counter for Switcher class IDs needs to reset per request (e.g., to keep IDs stable across SSR reruns in tests). If tests prove flaky, swap to a deterministic per-render counter via a cookie-free request-scoped context. Initial implementation uses module-scope; revisit only if tests fail.
- Exact wording of the comment in `document.tsx` documenting when to revisit the inline-CSS approach.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Component shape (canonical example: Cluster)

```tsx
// services/landing/app/ui/layout/cluster.tsx
import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface ClusterProps {
  space?: string
  justify?: string
  align?: string
  id?: string
  children?: RemixNode
}

export function Cluster() {
  return ({ space = 'var(--space-s)', justify = 'flex-start', align = 'center', id, children }: ClusterProps) => (
    <div
      class="cluster"
      id={id}
      mix={css({ '--space': space, '--justify': justify, '--align': align })}
    >
      {children}
    </div>
  )
}
```

### Slot-prop API (Cover)

```tsx
// services/landing/app/ui/layout/cover.tsx
export interface CoverProps {
  space?: string
  minHeight?: string
  noPad?: boolean
  centered: RemixNode      // explicit slot — gets .cover-centered wrapper
  children?: RemixNode     // rest — flows above/below depending on call-site order
}

export function Cover() {
  return ({ space = 'var(--space-m)', minHeight = '100vh', noPad = false, centered, children }: CoverProps) => (
    <div
      class="cover"
      mix={css({ '--space': space, '--min-height': minHeight, '--padding': noPad ? '0' : space })}
    >
      <div class="cover-centered">{centered}</div>
      {children}
    </div>
  )
}
```

### Per-instance inline style (Switcher)

```tsx
// services/landing/app/ui/layout/switcher.tsx
let switcherCounter = 0   // module-scoped, deterministic per server boot

export function Switcher() {
  const id = ++switcherCounter
  const scopedClass = `switcher-${id}`
  return ({ threshold = '30rem', space = 'var(--space-s)', limit = 4, children }: SwitcherProps) => {
    const limitRule = `.${scopedClass} > :nth-last-child(n+${limit + 1}),
                       .${scopedClass} > :nth-last-child(n+${limit + 1}) ~ * { flex-basis: 100%; }`
    return (
      <>
        {limit !== 4 && <style>{limitRule}</style>}
        <div class={`switcher ${scopedClass}`} mix={css({ '--threshold': threshold, '--space': space })}>
          {children}
        </div>
      </>
    )
  }
}
```

### CSS delivery (document.tsx)

```tsx
// services/landing/app/ui/document.tsx
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

// Inlined at module load. Revisit triggers: total inlined CSS > ~10–15 KB,
// a second/third co-located CSS file appears, or a CSS build step lands.
const COMPOSITION_CSS = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'layout/composition.css'),
  'utf-8',
)

// In <head>, after base.css/theme.css <link>s:
<style>{COMPOSITION_CSS}</style>
```

---

## Implementation Units

### U1. Inline `composition.css` into `document.tsx`

**Goal:** Make the composition CSS reach the browser on every HTML response so converted components actually have the layout rules they reference.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `services/landing/app/ui/document.tsx`
- Test: `services/landing/test/ui/document.test.tsx`

**Approach:**
- Read `composition.css` once at module load via `fs.readFileSync` + `fileURLToPath(import.meta.url)` to compute the path relative to `document.tsx`.
- Capture the file contents in a module-scoped constant.
- Emit `<style>{COMPOSITION_CSS}</style>` in `<head>` after the existing `<link>`s for `base.css` and `theme.css` (so composition rules sit at the same cascade specificity tier as theme primitives, but win on source-order ties).
- Add a comment naming the revisit triggers (total inlined CSS > ~10–15 KB, second/third co-located CSS file, real CSS build step).

**Patterns to follow:**
- Existing module-scoped constants in `assets-server.ts` (e.g., `ROOT_DIR`, `ASSET_BASE_PATH`).
- The doc-comment style in `document.tsx`'s existing JSDoc.

**Test scenarios:**
- Happy path: `renderToString(<Document title="x" />)` emits a `<style>…</style>` block whose contents include `.stack {`, `.cluster {`, `.cover-centered {`, and `.switcher {`. Asserts the file was inlined and key class names survived.
- Edge case: emitted `<style>` block sits inside `<head>`, after the existing `<link rel="stylesheet" href="/styles/theme.css">` (regex on the full HTML to confirm ordering).
- Error path: deliberately point the read at a missing path during a unit test — assert it throws synchronously at module load (not at first request). This pins the "fail fast at boot" contract and catches future moves of the file.

**Verification:**
- `pnpm typecheck` passes.
- A manual `pnpm dev` + browser load shows `.stack`, `.cluster`, etc. defined when inspecting the rendered HTML.

---

### U2. Convert Cluster, Grid, Reel

**Goal:** Port the three simplest primitives (no children introspection, no per-instance state) to Remix 3 idioms.

**Requirements:** R1, R2, R3

**Dependencies:** U1

**Files:**
- Create: `services/landing/app/ui/layout/cluster.tsx`
- Create: `services/landing/app/ui/layout/grid.tsx`
- Create: `services/landing/app/ui/layout/reel.tsx`
- Delete: `services/landing/app/ui/layout/Cluster.tsx`
- Delete: `services/landing/app/ui/layout/Grid.tsx`
- Delete: `services/landing/app/ui/layout/Reel.tsx`
- Test: `services/landing/test/ui/layout/cluster.test.tsx`
- Test: `services/landing/test/ui/layout/grid.test.tsx`
- Test: `services/landing/test/ui/layout/reel.test.tsx`

**Approach:**
- For each: switch to the `function ComponentName() { return (props) => jsx }` factory pattern.
- Replace `ReactNode` → `RemixNode`, `className` → `class`, `style={cssVars}` → `mix={css({...})}`.
- Drop the `& Omit<HTMLAttributes<HTMLDivElement>, "className">` rest spread; keep only the layout-specific props plus `id` and `children`.
- Reel keeps the `noBar` boolean → conditional `reel-no-bar` class.
- All three set CSS variables (`--space`, `--justify`, `--align`, `--grid-min`, `--item-width`, `--reel-height`) on the root via `mix={css({...})}`.

**Patterns to follow:**
- `services/landing/app/ui/card.tsx` for the factory-and-class shape.
- `services/landing/app/ui/avatar.tsx` for `mix={css({...})}` with multiple values.

**Test scenarios:**
- Happy path (Cluster): `renderToString(<Cluster space="2rem" justify="center" align="end">…</Cluster>)` emits a `<div>` with `class="cluster"` and a generated mix-class whose generated rule contains `--space: 2rem`, `--justify: center`, `--align: end`. Children pass through.
- Happy path (Grid): defaults emit `--grid-min: 250px` and `--space: var(--space-m)` on the root; explicit `min="180px"` override is reflected.
- Happy path (Reel): default does not include `reel-no-bar`; `<Reel noBar>…</Reel>` adds `reel-no-bar` to the class list and emits `--item-width`, `--reel-height`, `--space`.
- Edge case: passing only required-by-default props (no overrides) emits the documented default values for each CSS variable.

**Verification:**
- `pnpm typecheck` passes.
- The three new files exist; the old PascalCase files are gone (`git status` shows three deletes + three creates).

---

### U3. Convert Sidebar and `AspectFrame` (renamed from `Frame`)

**Goal:** Port Sidebar (variant-bearing) and rename Frame to AspectFrame to avoid collision with `remix/ui`'s exported `Frame`.

**Requirements:** R1, R2, R3, R8

**Dependencies:** U1

**Files:**
- Create: `services/landing/app/ui/layout/sidebar.tsx`
- Create: `services/landing/app/ui/layout/aspect-frame.tsx`
- Delete: `services/landing/app/ui/layout/Sidebar.tsx`
- Delete: `services/landing/app/ui/layout/Frame.tsx`
- Test: `services/landing/test/ui/layout/sidebar.test.tsx`
- Test: `services/landing/test/ui/layout/aspect-frame.test.tsx`

**Approach:**
- Same conversion shape as U2.
- Sidebar: `side` prop ("left" | "right") gates the `sidebar-right` class; emits `--side-width`, `--content-min`, `--space`.
- AspectFrame: identical to the original Frame except the file/component renames; emits `--ratio`. CSS class stays `.frame` because composition.css already references it.
- Add a comment block at the top of `aspect-frame.tsx` explaining the rename rationale (collision with `remix/ui`'s `Frame`) so future readers don't undo it.

**Patterns to follow:**
- `services/landing/app/ui/button.tsx` for the variant-as-class concatenation pattern.

**Test scenarios:**
- Happy path (Sidebar default): renders `class="sidebar"` with no `sidebar-right`, emits `--side-width: 20rem`, `--content-min: 50%`, `--space: var(--space-l)`.
- Happy path (Sidebar right): `<Sidebar side="right">` renders `class="sidebar sidebar-right"`.
- Happy path (AspectFrame): default `<AspectFrame>` emits `--ratio: 16 / 9`; `<AspectFrame ratio="1 / 1">` emits `--ratio: 1 / 1`.
- Integration: `import { Frame } from 'remix/ui'` and `import { AspectFrame } from './aspect-frame.tsx'` co-exist in a test file without collision (smoke-typecheck via TS).

**Verification:**
- `pnpm typecheck` passes.
- `grep -r "from './Frame" services/landing` returns nothing (no stale imports).

---

### U4. Convert Stack (drop `splitAfter` in favor of `stack-split` class on a child)

**Goal:** Port Stack to Remix 3 without React's `Children.toArray`. Replace the `splitAfter` numeric prop with documentation that consumers can wrap any single child in `<div class="stack-split">…</div>` to mark the split boundary; composition.css already targets that class.

**Requirements:** R1, R2, R3, R5

**Dependencies:** U1

**Files:**
- Create: `services/landing/app/ui/layout/stack.tsx`
- Delete: `services/landing/app/ui/layout/Stack.tsx`
- Test: `services/landing/test/ui/layout/stack.test.tsx`

**Approach:**
- Standard conversion shape (factory, `class`, `mix={css({...})}`, narrow API).
- Drop `splitAfter`. The component renders a single `<div class="stack">` (plus optional `stack-recursive`) with children passed through verbatim.
- Add a JSDoc block explaining the consumer-side split pattern: "to split content at a boundary, wrap the child where the split should occur in `<div class='stack-split'>…</div>`."

**Patterns to follow:**
- `card.tsx` factory shape.

**Test scenarios:**
- Happy path: `<Stack space="1rem">{a}{b}{c}</Stack>` renders `class="stack"` with `--space: 1rem` and three children in order.
- Variant: `<Stack recursive>` renders `class="stack stack-recursive"`.
- Integration (split): `<Stack>{a}<div class="stack-split">{b}</div>{c}</Stack>` emits the `stack-split` class on the middle child unchanged. (Smoke test that consumer-side tagging is preserved through SSR — composition.css does the rest in the browser.)

**Verification:**
- `pnpm typecheck` passes.
- New `stack.tsx`'s JSDoc names the consumer-side split pattern explicitly so future readers know how to migrate from the original `splitAfter` API.

---

### U5. Convert Cover (replace `Children.map` first-child wrap with `centered` slot prop)

**Goal:** Port Cover to Remix 3 without React's `Children.map`. Take an explicit `centered: RemixNode` slot prop, wrap it server-side in `<div class="cover-centered">`, and render remaining `children` after it.

**Requirements:** R1, R2, R3, R6

**Dependencies:** U1

**Files:**
- Create: `services/landing/app/ui/layout/cover.tsx`
- Delete: `services/landing/app/ui/layout/Cover.tsx`
- Test: `services/landing/test/ui/layout/cover.test.tsx`

**Approach:**
- Standard conversion shape.
- API change: `centered: RemixNode` becomes a required prop (no default — Cover without centered content makes no sense). `children` becomes the optional after-content.
- Render `<div class="cover" {mix}>` containing `<div class="cover-centered">{centered}</div>{children}`.
- `--padding` derives from `noPad ? '0' : space`, matching the original.

**Patterns to follow:**
- The slot-prop pattern in `top-bar.tsx` (`right?: RemixNode`).

**Test scenarios:**
- Happy path: `<Cover centered={<h1>Hi</h1>}>extra</Cover>` emits `<div class="cover">` with `--min-height: 100vh`, `--space: var(--space-m)`, `--padding: var(--space-m)` and contains `<div class="cover-centered"><h1>Hi</h1></div>extra`.
- Variant (`noPad`): `<Cover noPad centered={…}>` emits `--padding: 0`.
- Edge case: `<Cover centered={…} />` with no `children` emits exactly the `.cover-centered` wrapper and nothing after.
- Edge case: `minHeight="80vh"` propagates to `--min-height: 80vh`.

**Verification:**
- `pnpm typecheck` passes.
- The first child of `.cover` in emitted HTML is always `<div class="cover-centered">…</div>` (the rule composition.css's `.cover > :first-child:not(.cover-centered)` exists to handle is now unreachable in practice — that's fine; the rule remains as a safety net).

---

### U6. Convert Switcher (per-instance inline `<style>` with module counter)

**Goal:** Port Switcher to Remix 3 without `useId`/`useEffect`. Generate a unique class per instance via a module-scoped counter and emit a sibling `<style>` block with the right `:nth-last-child(n+limit+1)` rule when `limit` differs from the default.

**Requirements:** R1, R2, R3, R7

**Dependencies:** U1

**Files:**
- Create: `services/landing/app/ui/layout/switcher.tsx`
- Delete: `services/landing/app/ui/layout/Switcher.tsx`
- Test: `services/landing/test/ui/layout/switcher.test.tsx`

**Approach:**
- Module-scoped counter: `let switcherCounter = 0`. Increment in the outer factory closure (`function Switcher() { const id = ++switcherCounter; … }`), so each `<Switcher>` element in the render tree gets a stable scoped class for the lifetime of the SSR pass.
- Default `limit = 4` — when `limit === 4`, skip the `<style>` emission entirely (composition.css's base `.switcher` rule covers the default case).
- Otherwise emit `<style>{rule}</style>` as a fragment sibling to the `<div class="switcher switcher-N">`. The rule mirrors the original effect: `.switcher-N > :nth-last-child(n+${limit+1}), .switcher-N > :nth-last-child(n+${limit+1}) ~ * { flex-basis: 100%; }`.
- Set `--threshold` and `--space` via `mix={css({...})}`.
- Add a comment explaining the counter's per-server-boot semantics and the revisit trigger (swap to enumerated `.switcher-limit-N` classes in composition.css if many Switchers ship with the same limit).

**Patterns to follow:**
- The factory-with-closure-state pattern is unique to this component in the repo; no exact precedent. The closest analog is the way `assets-server.ts` captures module-level state.

**Test scenarios:**
- Happy path (default limit): `<Switcher>{a}{b}</Switcher>` emits `<div class="switcher switcher-N">` with `--threshold: 30rem`, `--space: var(--space-s)` and **no** sibling `<style>` block (default skip).
- Happy path (custom limit): `<Switcher limit={2}>` emits a sibling `<style>` block whose contents include `.switcher-N > :nth-last-child(n+3)` and `flex-basis: 100%`.
- Edge case: two `<Switcher>` elements rendered in the same pass get distinct scoped class IDs (`switcher-N` and `switcher-N+1`), and each `<style>` block scopes to only its own ID.
- Edge case: `limit={0}` and `limit={1}` produce well-formed `:nth-last-child` rules (no off-by-one).
- Integration: `renderToString` of a tree with a Switcher inside a Stack inside a Cover renders the `<style>` block correctly nested inside the Switcher's parent (no escape into `<head>`).

**Verification:**
- `pnpm typecheck` passes.
- Switcher's module file contains the `switcherCounter` declaration, the `++` increment in the outer factory, and the limit-default skip path (grep-able invariants).
- Tests covering the default-skip path are not flaky across reruns (the counter restart per test process is acceptable; if it becomes an issue, swap to a per-render counter in follow-up).

---

## System-Wide Impact

- **Interaction graph:** `document.tsx` gains an `fs.readFileSync` at module load. No new HTTP routes; no middleware changes; the asset server is untouched.
- **Error propagation:** A missing or unreadable `composition.css` throws at module load (server boot), not at request time. Tests in U1 pin this contract.
- **State lifecycle risks:** Switcher's module-scoped counter is process-global. If the same render tree renders deterministically across requests, IDs differ per request — that's fine because the `<style>` block is co-located with its target div on every render. The risk to watch is test ordering (counter increases monotonically across test cases); tests should assert relative properties (presence of class, presence of matching style) rather than exact `switcher-1`/`switcher-2` values.
- **API surface parity:** None of these components had public consumers prior to this plan (the original React versions were imported but not used). The API change (Stack drops `splitAfter`, Cover requires `centered`) is therefore unobserved; no migration burden on existing call sites.
- **Integration coverage:** U6's "two Switchers in one render" test pins the multi-instance behavior. U1's CSS-inlining test pins document-level wiring. Per-component tests pin individual class/CSS-var emission.
- **Unchanged invariants:** `services/landing/public/styles/theme.css` is not modified; `wf-*` primitives keep their existing rules and tokens. The asset server (`assets-server.ts`) and static-files middleware (`router.ts`) are not modified. `clientEntry`-bearing components (e.g., `suggestion-chips.tsx`) are unaffected.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Inlining composition.css bloats every HTML response (~4 KB now). | Documented revisit triggers (>10–15 KB total inlined, second co-located CSS file, build step). Migration cost is small (10-line GET route); no architectural lock-in. |
| Switcher's module-scoped counter produces non-deterministic IDs across test runs, making string-equality assertions flaky. | Tests assert structural invariants (class present, sibling style block targets the same class) rather than exact ID values. Documented in U6's verification section. |
| `fs.readFileSync` at module load fails in some deployment envs (e.g., serverless with read-only fs at runtime — currently not in scope, but a future migration risk). | Failure surfaces at boot, not at request time, so it's loud and easy to triage. If a serverless target lands later, swap to an embed-at-build-time step or the GET-route alternative. |
| Composition.css references CSS variables (`--space-s`, `--color-border`, etc.) not defined in `theme.css` — fallbacks work for unused primitives (`.box`, `.center`) but could surprise a reader. | Out-of-scope for this plan; the `.box`/`.center`/`.flow` rules ship dormant. Note this in U1 implementation as an "expected dead code, do not chase" comment. |
| Test files are landing in a new `test/ui/layout/` directory that doesn't exist today. | U2 creates it explicitly via the first new test file; subsequent units add siblings. |

---

## Documentation / Operational Notes

- No runtime config changes. No env var changes. No new dependencies.
- The new components are not yet wired into any page; the next PR (out of scope here) adopts them in `actions/home/page.tsx` and `actions/sessions/page.tsx`.
- `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` already covers the camelCase-attribute pitfall; nothing new to add. If implementation surfaces a new failure mode (e.g., `mix={css(...)}` mishandling some CSS variable), add a follow-up `docs/solutions/` entry.

---

## Sources & References

- Imported components: `services/landing/app/ui/layout/{Cluster,Cover,Frame,Grid,Reel,Sidebar,Stack,Switcher}.tsx`
- Co-located CSS: `services/landing/app/ui/layout/composition.css`
- Document shell: `services/landing/app/ui/document.tsx`
- Canonical Remix 3 component shape: `services/landing/app/ui/{card,button,chip,avatar,top-bar,progress-track}.tsx`
- SSR test pattern: `services/landing/test/actions/done-banner.test.tsx`
- JSX attribute pitfalls: `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md`
- Landing redesign anchor plan: `docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md`
- Every Layout primitives: https://every-layout.dev/
