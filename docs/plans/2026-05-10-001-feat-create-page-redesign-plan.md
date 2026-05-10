---
title: "feat: Redesign Create page to match Create-Prompt Hi-Fi; remove repo/branch UI"
type: feat
status: completed
date: 2026-05-10
---

# feat: Redesign Create page to match Create-Prompt Hi-Fi; remove repo/branch UI

## Summary

Redesign `services/landing/app/actions/home/page.tsx` to match `docs/designs/Create Prompt Hi-Fi.html` — 56px crumbs chrome, left-aligned editorial headline, an elevated composer card with an 18px-display textarea and a borderless toolbar band, a derived "lives at <slug>" ghost line, an alts-row of starting-points, the lowercase "try" suggestions, and a footer prose line. Drop the visible repo/branch advanced expander; the controller plumbs default values server-side so `CreateSchema` continues to validate without a Session-API contract change. New behavior ships as three small clientEntries (auto-grow textarea, derived slug, ⌘/Ctrl+Enter shortcut on a redesigned `StartSessionButton`). The drag-drop zip flow, codebase-attached resume mode, and functional alts are explicitly deferred.

---

## Problem Frame

The current Create page (`services/landing/app/actions/home/page.tsx`) renders the original wireframe variant 02-B — a centered "Step 1 of 1" eyebrow + h1, a small line-card holding the textarea, a row of disabled chips, and a `<details>` expander asking for a Git repo URL and base branch. The Hi-Fi reference at `docs/designs/Create Prompt Hi-Fi.html` is a different surface: an editorial hero with a left-aligned headline, a hero composer card, a derived subdomain ghost, and four alternative starting points. The repo/branch fields are gone — the design assumes a prompt-only flow.

The product intent (per user feedback): users should not be required to supply a Git repo URL to start a session. Hide the inputs, default the values server-side for v1, and revisit the underlying Session-API contract separately. Same module, same Remix-3-in-`services/landing/` surface, same composition primitives shipped by the just-merged Ready redesign — different page.

---

## Requirements

- R1. The Create page renders to the structural shape of `docs/designs/Create Prompt Hi-Fi.html`: 56px sticky crumbs header (`workspace / new app` + ghost "← Back to apps" + Avatar); left-aligned editorial hero (display headline + sub-prose); elevated composer card containing a borderless 18px-display textarea, a derived "lives at <slug>" ghost line, and a toolbar band footer (Attach / Stack / DB tools + ⌘+↵ hint + ink/paper "Start session →" button); alts row of four pill buttons; lowercase "try" suggestions; muted footer prose.
- R2. The page composes via the layout primitives per `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md`: one outer max-width wrapper, one Stack of sections, no per-row max-width plumbing. Sections needing a narrower visual width (the Hero's prose column at `var(--w-prose)` ≈ 560px) get an inner wrapper inside their own block.
- R3. The repo/branch advanced expander is removed from the rendered form. The controller injects default repo/branch values server-side before posting to the Session API so the existing `CreateSchema` validation continues to pass without a contract change.
- R4. Behavioral additions ship as three small clientEntries under `services/landing/app/actions/home/client/`:
  - `StartSessionButton` (replaces today's `SubmitButton`) — embedded kbd, pending flip, disabled-until-prompt-≥8-chars, and the ⌘+Enter / Ctrl+Enter submit shortcut.
  - `AutoGrowTextarea` — invisible enhancement that grows the textarea up to a max height as the user types.
  - `DerivedSlug` — invisible enhancement that updates the "lives at <slug>.openvoid.dev" ghost line as the user types.
- R5. The Hi-Fi's drag-drop zip flow, codebase-attached resume mode, and functional alts buttons are not implemented in v1. The alts buttons render but click does nothing (parking lots).
- R6. New CSS recipes land in `services/landing/public/styles/blocks.css` (CUBE Block layer): `.wf-composer`, `.wf-composer-bar`, `.wf-tool`, `.wf-btn-go`, `.wf-alt`. Inline mix is used only for one-off element styling that doesn't justify a recipe (e.g., the prose-line wrapper).
- R7. Controller-side contracts unchanged: idempotency-key plumbing, error re-render with `previousValues`, redirect on success, Done banner round-trip from `?done=&repo=&branch=` URL params. The DoneBanner component itself is untouched.
- R8. The existing controller test (`services/landing/test/actions/home.controller.test.ts`) keeps satisfying its idempotency, error-handling, and DoneBanner pins; pins that target the old wireframe copy and the repo/branch inputs migrate to the new design copy and the no-input shape.

---

## Scope Boundaries

- Body redesigns of any other page (Sessions, Done banner content, Failed/Stopping states) — out of scope.
- Drag-drop zip upload UX (`.drop-overlay`, `.attached` codebase card) — out of scope; needs a Session-API zip-ingest endpoint that doesn't exist.
- Codebase-attached resume mode (headline / sub / button-label / suggestions all swap when a codebase is attached) — out of scope; depends on the zip-ingest pipeline above.
- Functional alts buttons — Template gallery, GitHub repo import, .zip upload, Fork example. Each is its own feature with separate Session-API contract work.
- Workspace breadcrumb plumbing — still hardcoded `'maria'` in the chrome until auth lands; same v1 deferral as Ready.
- Real subdomain registry behind "lives at <slug>.openvoid.dev" — display-only in v1; the actual session URL still derives from `sessionId`, not the prompt-derived slug.
- Making repo/branch optional in `CreateSchema` and the upstream Session-API contract — handled via server-side defaults, not contract change.

### Deferred to Follow-Up Work

- Drag-drop zip ingest backend + UI flow (separate plan; needs Session-API endpoint).
- Resume mode (headline / suggestions / CTA swap when codebase attached).
- Each functional alts button (Template, GitHub import, Fork example) — separate features, separate plans.
- Auth-layer plumbing of real workspace name into the crumbs chrome.
- Audit + capture clientEntry patterns (auto-grow textarea, ⌘+Enter shortcut binding) into `docs/solutions/` after this lands.

---

## Context & Research

### Relevant Code and Patterns

- `services/landing/app/actions/home/page.tsx` — the file being rewritten.
- `services/landing/app/actions/home/controller.tsx` — gains default repo/branch injection.
- `services/landing/app/actions/home/done-banner.tsx` — untouched.
- `services/landing/app/actions/home/client/submit-button.tsx` — replaced by `start-session-button.tsx`.
- `services/landing/app/actions/home/client/suggestion-chips.tsx` — contract widens to `{label, fill}` pairs (today's `string[]` is treated as both label and fill).
- `services/landing/app/actions/sessions/components/ready.tsx` — composition reference: outer max-width wrapper + Stack + `Cover.centered`. Apply the same shape, narrower stage (760px vs Ready's 920px).
- `services/landing/app/ui/layout.tsx` — `mainKind='full'` and `topBarChrome` API already shipped by Ready.
- `services/landing/app/ui/top-bar.tsx` — crumbs mode already shipped.
- `services/landing/app/ui/card.tsx` — `Card variant="elevated"` exists. The composer surface needs `:focus-within` halo and `overflow: hidden`, which are awkward to inline-mix; v1 uses a dedicated `.wf-composer` recipe layered on `.wf-card-elev`.
- `services/landing/app/ui/avatar.tsx` — reused as-is.
- `services/landing/app/ui/textarea.tsx` — already renders `{defaultValue}` as child text correctly, but its baked-in `wf-input` class is wrong for the borderless 18px composer textarea. v1 renders the `<textarea>` inline in `home/page.tsx` (one-off shape; not worth a primitive variant).
- `services/landing/public/styles/blocks.css` — gains the new recipes.
- `services/landing/public/styles/tokens.css` — width tokens already present (`--w-stage: 760px` matches the design's stage width exactly).
- `services/landing/test/actions/home.controller.test.ts` — pins migrate.
- `services/landing/test/ui/styles/blocks.test.ts` — selector allow-list extends with the new recipes.

### Institutional Learnings

- `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md` — single outer max-width + Stack + cross-axis stretch. Apply at every composition point in the page rewrite. Footer-prose narrowing, if needed, lives inside the footer's own wrapper, not as a sibling-of-Stack concern.
- `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` — Remix 3 SSR lowercases unrecognized camelCase attributes silently. Inline-rendered `<textarea>` MUST carry `previousValues.prompt` as child text (not `defaultValue=`), or the controller's re-render-with-previous-values round-trip silently breaks. Same trap for any new camelCase HTML attributes (`autoFocus`, `spellCheck`, `autoComplete`, `maxLength`, `readOnly`) — pass as their HTML-spelled lowercase names.

### External References

- `docs/designs/Create Prompt Hi-Fi.html` — the visual reference. Where it diverges from the canonical OpenVoid Tokens, Tokens is canonical.
- `docs/designs/OpenVoid Tokens.html` — canonical token reference.
- PR #25 — feat/ready-page-redesign (the just-merged page that established the chrome + composition primitives this plan reuses).

---

## Key Technical Decisions

- **Composer surface: dedicated `.wf-composer` recipe** layered on `.wf-card-elev`. The `:focus-within` accent-soft halo and `overflow: hidden` (so the toolbar band's paper-2 background respects the rounded bottom corners) are clumsy to express via inline mix. The Card primitive remains untouched; the composer's `<form>` element gets the `.wf-composer` class directly.
- **Submit button: dedicated `.wf-btn-go` recipe**, distinct from `.wf-btn-action-pri`. Three differences from `.wf-btn-action-pri` justify a separate recipe — 9px radius (vs `--r-sm` = 7px), 16px horizontal padding (vs `var(--sp-5)` = 12px), and an embedded translucent-white kbd inside the button (no analog in the existing recipe). A `data-` variant on `.wf-btn-action-pri` would smear two semantically-distinct shapes; the recipe is small.
- **Composer textarea: inline render** in `home/page.tsx`. The `Textarea` primitive's hard-coded `wf-input` class is wrong for the borderless 18px display shape, and the textarea has exactly one consumer. A `variant="bare"` on the primitive would carry no other consumer and would inflate the primitive's API for a single use site. Render inline, with `previousValues.prompt` as child text per the JSX-attribute-naming learning.
- **Three small clientEntries, not one consolidated.** `StartSessionButton`, `AutoGrowTextarea`, `DerivedSlug` each listen on the prompt textarea's input event but update different DOM targets and have independent failure modes. Three small clientEntries are testable in isolation and match the existing `SubmitButton`/`SuggestionChips` per-behavior pattern. The cost of three `addEventListener('input', …)` registrations is trivial.
- **⌘+Enter / Ctrl+Enter listener lives in `StartSessionButton`.** The shortcut triggers a form submit; the button owns the form-submit contract; the listener registers in the same clientEntry that renders the button. Single `handle.signal` cleanup. No separate clientEntry for the shortcut.
- **`SuggestionChips` widens its prop type** from `suggestions: string[]` to `suggestions: Array<{ label: string; fill: string }>`. The label is the chip's visible text; the fill is what replaces the textarea content on click. Today's home page is the only consumer.
- **Repo/branch defaults: hardcoded constants in the controller** (`DEFAULT_REPO`, `DEFAULT_BRANCH`). The actual values are an implementation-time decision deferred to U3 — the placeholder must be a URL the upstream Session API accepts. The plan does NOT change `CreateSchema` to make repo/branch optional; defaults are injected before validation.
- **Form fields: `prompt` and `idempotencyKey` only.** No `name="repo"` or `name="branch"` inputs render. The controller reads only `prompt` and `idempotencyKey` from form data; repo/branch come from the constants.
- **Footer placement: last Stack member, no bottom-pinning.** The Hi-Fi uses `margin-top: auto` to push the footer to the viewport bottom. The Ready redesign established the precedent of accepting a natural-flow footer rather than fighting Cover's centered slot. The visual delta is small and the layout pattern stays clean.
- **Alts row: `Cluster` of `.wf-alt` pill buttons, click → no-op.** Buttons render with `disabled` semantics OR a `data-coming-soon` attribute and a tooltip — implementation-time choice. Either way, no functional behavior in v1.
- **Hero alignment: left** (matches design). Drop the existing `Eyebrow` "Step 1 of 1" — the design has nothing above the headline.
- **Stage max-width: 760px** (`var(--w-stage)`) — design's stage width matches the canonical token exactly. No 920px override like Ready's editorial-stage decision.

---

## Open Questions

### Resolved During Planning

- *Hide repo/branch UI, server-side defaults vs make optional in `CreateSchema`?* — Server-side defaults. Backend contract unchanged.
- *Composer surface: new recipe vs Card override?* — New `.wf-composer` recipe.
- *Submit button: new recipe vs extend `.wf-btn-action-pri`?* — New `.wf-btn-go` recipe.
- *Composer textarea: extend `Textarea` primitive vs inline render?* — Inline render in the page.
- *clientEntries: one consolidated vs three small?* — Three small (`StartSessionButton`, `AutoGrowTextarea`, `DerivedSlug`).
- *⌘+Enter listener: separate clientEntry vs inside `StartSessionButton`?* — Inside the button.
- *Suggestions: keep today's short labels or use design's longer fill text?* — Both. `SuggestionChips` widens to `{label, fill}` pairs; design's labels stay short, fill text from the design replaces the textarea.
- *Footer: bottom-pin via Cover stack-split vs natural-flow last Stack member?* — Natural flow.
- *Alts row: `Cluster` or `Switcher`?* — `Cluster`; the alts wrap naturally and don't need split-or-stack behavior.

### Deferred to Implementation

- *Actual default repo URL value.* Must be a URL the Session API accepts (currently the API attempts to clone). Candidates: a maintained empty `https://github.com/openvoid/scratch` repo, or detect the API's behavior at implementation time. If the API requires the repo to exist, capture the chosen URL as a constant in the controller with a code comment explaining the v1 assumption; flag for follow-up if API behavior reveals a tighter constraint.
- *Whether to add a `data-prompt-id` attribute to the textarea (the clientEntries currently use `getElementById('prompt')`).* Using a stable id is fine for now; if a second composer ever ships on a different page, reach for a data attribute then.

### Deferred for Product Decision

These three premise questions surfaced in the doc-review pass on 2026-05-10. Each is a real product call worth answering before /ce-work, but none blocks implementation if the agent ships the plan as written. Resolve at the user's discretion.

- *"Lives at &lt;slug&gt;.openvoid.dev" UI promise vs backend mismatch.* The plan ships the slug as decorative — derived client-side, displayed as the user types, but the actual session URL is `/sessions/<sessionId>`. Three resolutions: (a) keep as decorative and accept the trust hit on first interaction, (b) replace with a generic phrase like "your app gets a unique URL once it's running," (c) defer the slug feature entirely until a real subdomain registry lands. (a) is what the plan currently ships; (b) protects users from the misleading affordance; (c) is the cleanest but loses a piece of the design's character.
- *Should v1 render the four alts buttons (Template / GitHub import / .zip upload / Fork example) or omit until at least one is functional?* The plan currently ships all four as `data-coming-soon` parking lots. Trade-off: the design's identity claim (four ways to start) vs. the trust cost of users clicking buttons that don't lead anywhere. Especially "Upload codebase (.zip)" — the most concrete affordance for developers evaluating the tool — could conclude the tool can't accept their codebase when the click does nothing.
- *Should v1 render the three composer-toolbar tools (Attach / Stack:auto / DB:postgres) or omit until functional?* Same shape as the alts question. Stronger identity claim than the alts row because the labels carry specific technical commitments (postgres, auto stack detection) the system isn't actually making. A developer who clicks `DB: postgres` expecting to swap to MySQL/SQLite and finds it inert may conclude the customization story is broken.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Page composition

```
HomePage
└── Layout(mainKind='full',
          topBarChrome={mode:'crumbs', here:'new app'},
          topBarRight=<HeaderRight> /* "← Back to apps" + Avatar */)
    └── div(maxWidth: var(--w-stage), margin: 0 auto, width: 100%)
        └── Stack(space: var(--sp-10))
              ├── Hero (left-aligned: headline + sub)
              ├── Composer (form.wf-composer)
              │     └── Stack
              │           ├── <textarea> (inline, 18px, borderless)
              │           ├── DerivedSlug (lives-at ghost line)
              │           └── ComposerBar (.wf-composer-bar)
              │                 ├── Cluster (Tools: Attach, Stack:auto, DB:postgres)
              │                 └── SubmitArea (kbd hint + StartSessionButton)
              ├── Alts (Cluster of 4 .wf-alt pill buttons)
              ├── Suggestions ("try" label + SuggestionChips)
              └── Footer (prose + parking-lot link)
```

### Controller flow (default repo/branch injection)

```
POST /
  formData ← get(FormData)                         // carries { prompt, idempotencyKey }
  formData.set('repo', DEFAULT_REPO)               // inject defaults BEFORE parse
  formData.set('branch', DEFAULT_BRANCH)
  parsed = parseSafe(CreateSchema, formData)       // schema is f.field-based; consumes FormData
  if (!parsed.success) → re-render with error + previousValues
  createSession({ repo, branch }, idempotencyKey)
  redirect → /sessions/:id
```

The `CreateSchema` itself stays unchanged (still requires all four fields and consumes FormData via `f.field`). The injection happens at the controller boundary by mutating the FormData before parse; tests assert the upstream `createSession` call carries the default values.

---

## Implementation Units

### U1. Add new CSS recipes to `blocks.css`

**Goal:** Land the seven new component-recipe classes the redesign needs.

**Requirements:** R1, R6

**Dependencies:** None

**Files:**
- Modify: `services/landing/public/styles/blocks.css`
- Modify: `services/landing/test/ui/styles/blocks.test.ts`

**Approach:**
- Add `.wf-composer` — built on top of `.wf-card-elev`'s shape but with `padding: 0`, `overflow: hidden`, and a `:focus-within` rule that adds `box-shadow: var(--shadow-2), 0 0 0 4px var(--accent-soft)`. The `<form>` element carries the class directly, not a wrapping `Card variant="elevated"`.
- Add `.wf-composer-bar` — flex row, `border-top: 1px solid var(--line-2)`, `background: var(--paper-2)`, `padding: 12px 14px 14px 18px`, `gap: var(--sp-3)`. Append the design's narrow-viewport rule: `@media (max-width: 720px) { .wf-composer-bar { flex-wrap: wrap } .wf-composer-bar .wf-submit-area { margin-left: 0; width: 100%; justify-content: flex-end } }` so the submit button stays reachable on mobile.
- Add `.wf-tool` — borderless toolbar button, 30px tall, transparent background, `var(--ink-3)` text, mono `.lbl-key` inner span, hover to `var(--ink)`. Add `.wf-tool` to the existing focus-visible composite selector in `blocks.css` (alongside `.wf-btn`, `.wf-link`, `.wf-chip`, `.wf-btn-action`) so it inherits the `--focus-ring` halo — there is no global focus rule that catches it otherwise.
- Add `.wf-btn-go` — 36px tall, semibold 13px, ink/paper, 9px radius, 16px horizontal padding. Inner content slot: `<span>{label}</span><svg>...</svg>` (per the design's arrow `M5 12h14M13 5l7 7-7 7`); the `.wf-keycap` glyphs live in the sibling `.wf-submit-area`, NOT inside the button itself.
- Add `.wf-alt` — 32px tall, `var(--paper-2)` bg, no border, `border-radius: 999px`, `var(--ink-2)` text, hover to `var(--paper-3)` + `var(--ink)`. SVG glyph slot styled to match. Include a `.wf-alt[data-coming-soon]` style that adds the tooltip-via-`title` pattern (cursor: not-allowed, slight opacity dim) so the parking-lot path U4 commits to has a visible disabled-but-still-hoverable affordance.
- Add `.wf-sug` — restyled suggestion chip on `--paper-2` background, 30px tall, with a `::before` arrow glyph (per the design's data-URI SVG `M12 19V5M5 12l7-7 7 7`). The existing `.wf-chip` recipe is unchanged; `SuggestionChips` (U2) emits the new class.
- Add `.wf-livesat` — paper-2 inline tag for the "lives at" ghost line (`var(--ink-3)` text, `var(--font-mono)` 12.5px, `padding: 2px 7px`, `border-radius: 5px`). Add a sibling rule `.wf-livesat[data-hidden] { opacity: 0; pointer-events: none }` plus `.wf-livesat { transition: opacity .25s ease }` so the slug fades in when the prompt crosses the 8-char threshold.
- Update the `blocks.css` selector test allow-list (the "contains the new component recipes" array in `test/ui/styles/blocks.test.ts`) to include all seven new selectors.

**Patterns to follow:**
- Existing `.wf-card-elev`, `.wf-btn-action-pri`, `.wf-toolbar-tall` recipes from PR #25.
- The CUBE Block-layer comment-block style (`/* ── Section ── */` dividers) already used in `blocks.css`.

**Test scenarios:**
- Happy path (recipe presence): `blocks.css` contains the seven new selectors; `test/ui/styles/blocks.test.ts` allow-list updated.
- Edge case (no `:root` regression): `blocks.css` test still asserts no `:root` block — unchanged from PR #25.
- Edge case (`:focus-within` rule emitted): the disk-load test for `.wf-composer` includes a scan for `:focus-within` to lock the focus halo behavior.
- Edge case (`.wf-tool` joins the focus-visible group): the disk-load test asserts `.wf-tool` appears in the focus-visible composite selector.
- Edge case (`@media (max-width: 720px)` wrap rule): the disk-load test asserts the `.wf-composer-bar` block carries the narrow-viewport wrap.

**Verification:**
- `pnpm typecheck` passes.
- `pnpm test` — `test/ui/styles/blocks.test.ts` extended assertions pass; existing tests unchanged.

---

### U2. Composer-enhancement clientEntries

**Goal:** Three small clientEntries the composer needs (`StartSessionButton`, `AutoGrowTextarea`, `DerivedSlug`), plus the `SuggestionChips` contract widening to `{label, fill}` pairs.

**Requirements:** R4

**Dependencies:** U1 (`.wf-btn-go` recipe used by `StartSessionButton`)

**Files:**
- Create: `services/landing/app/actions/home/client/start-session-button.tsx`
- Create: `services/landing/app/actions/home/client/auto-grow-textarea.tsx`
- Create: `services/landing/app/actions/home/client/derived-slug.tsx`
- Modify: `services/landing/app/actions/home/client/suggestion-chips.tsx` (widen `suggestions` prop type)
- Delete: `services/landing/app/actions/home/client/submit-button.tsx`
- Create: `services/landing/test/actions/home/client/start-session-button.test.tsx`
- Create: `services/landing/test/actions/home/client/auto-grow-textarea.test.tsx`
- Create: `services/landing/test/actions/home/client/derived-slug.test.tsx`

**Approach:**
- **`StartSessionButton`** — `Handle<{ targetId: string; label?: string; pendingLabel?: string }>` (textarea id is `'prompt'`). Renders the button as `<button type="submit" class="wf-btn-go">{label}<svg>{arrow}</svg></button>` — label + arrow only; the `⌘ ↵` kbd hint lives in a sibling `.wf-submit-area` span rendered by U4's page (NOT inside the button). The arrow SVG is the design's `M5 12h14M13 5l7 7-7 7` path. SSR fallback: emits the button **enabled** (drop the disabled-until-N-chars gate from SSR — the controller's `CreateSchema` validates prompt length server-side, so a no-JS submit with too-short prompt re-renders with the existing inline error; gating the button at the SSR layer would block no-JS users entirely, since the only flow on the page depends on this button). On hydration: register `input` listener on `document.getElementById(targetId)` to flip `disabled` based on `value.length >= 8`. Register a `keydown` listener on document for `(metaKey || ctrlKey) && key === 'Enter'` — gate on `textarea.value.length >= 8` (read directly from the DOM, not via the closure flag, to avoid the keydown-vs-input event-order race at the exact 8-char threshold) AND the form contains `document.activeElement` AND `event.preventDefault()` is called before `form.requestSubmit()` (so the textarea does not also receive the default newline insertion). Pending flip on form submit: label swaps to `pendingLabel ?? 'Starting session…'` (mirror today's `SubmitButton.startSubmit` queueTask pattern). Cleanup via `handle.signal`.
- **`AutoGrowTextarea`** — `Handle<{ targetId: string; maxHeight?: number }>`. Returns `null`. On hydration: define the resize routine as a closure (`textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight, maxHeight ?? 360) + 'px'`), call it once immediately so SSR-rendered multi-line `previousValues.prompt` content sizes correctly on first paint, then register the same routine as an `input` listener for ongoing resize. Cleanup via `handle.signal`.
- **`DerivedSlug`** — `Handle<{ targetId: string; slugId: string; wrapperId?: string; defaultSlug?: string }>`. Returns `null` (the `.wf-livesat` wrapper and the inner `<span>` are rendered by the page; the wrapper carries `data-hidden=""` initially). On hydration: register `input` listener that computes a slug from the textarea value (lowercase, alphanumeric + hyphens, stop-words filtered, max 3 words; mirror the design HTML's `slugify` function), updates the `<span>`'s text content, and toggles the `data-hidden` attribute on the WRAPPER (not the inner span — the opacity transition from U1 lives on `.wf-livesat[data-hidden]`) based on whether the prompt is ≥8 chars. Cleanup via `handle.signal`.
- **`SuggestionChips` widening** — change the prop type from `suggestions: string[]` to `suggestions: Array<{ label: string; fill: string }>`. Render the label inside the button as `<button class="wf-sug">{label}</button>` (drop the existing `wf-chip` class — the design uses the new `.wf-sug` recipe with the `::before` up-arrow); on click, replace the textarea's value with `fill`. Update the existing JSDoc comment.
- **Drop `SubmitButton`** — file removed; consumer migrates in U4.

**Patterns to follow:**
- `services/landing/app/actions/sessions/client/copy-button.tsx` — closure-state + `handle.update()` pattern.
- `services/landing/app/actions/sessions/client/open-link-shortcuts.tsx` — invisible-clientEntry document-level keydown listener with `{ signal: handle.signal }` cleanup, and the suppression guard for text-input focus (only relevant for the `StartSessionButton` keydown).
- Today's `services/landing/app/actions/home/client/submit-button.tsx` — `handle.queueTask` deferred visual flip on submit.

**Test scenarios:**
- `StartSessionButton` SSR fallback: emits `<button type="submit" class="wf-btn-go">` (NOT `disabled` — the no-JS path lets the user submit, and the controller validates). Inner content is the label text + the arrow SVG; no `<kbd>` children.
- `StartSessionButton` SSR fallback (custom label / pendingLabel): renders the supplied label; pending state behavior is exercised at hydration only.
- `AutoGrowTextarea` SSR fallback: emits no visible markup (empty hydration anchor only).
- `DerivedSlug` SSR fallback: emits no visible markup (the `.wf-livesat` wrapper + `<span>` are page-owned).
- `SuggestionChips` widened contract: rendering with `[{ label: 'Notion-style notes', fill: 'A Notion-style note app...' }]` emits a `<button class="wf-sug">` whose text content is the label, not the fill. SSR fallback test only — click behavior is implicit.
- (Deferred: behavioral tests for input-driven state require a jsdom-style harness this repo doesn't ship; SSR-only assertions match the PR #25 precedent for clientEntries.)

**Verification:**
- `pnpm typecheck` passes.
- `pnpm test` — all new clientEntry tests pass; nothing else regresses.

---

### U3. Controller — server-side default repo/branch

**Goal:** Inject default `repo` / `branch` values in the home controller so the form no longer carries those fields, while `CreateSchema` validation continues to pass and the upstream Session-API contract stays unchanged.

**Requirements:** R3, R7, R8

**Dependencies:** None

**Files:**
- Modify: `services/landing/app/actions/home/controller.tsx`
- Modify: `services/landing/test/actions/home.controller.test.ts`

**Approach:**
- Add module-scope constants `DEFAULT_REPO` and `DEFAULT_BRANCH` with a code comment explaining the v1 assumption (placeholder until repo selection ships). Implementation-time decision: the actual URL value (deferred to implementation per Open Questions).
- In `create()`, after `get(FormData)` returns, inject the defaults via `formData.set('repo', DEFAULT_REPO)` and `formData.set('branch', DEFAULT_BRANCH)` BEFORE calling `parseSafe(CreateSchema, formData)`. The schema is built with `f.field` from `remix/data-schema/form-data` and consumes FormData (the existing call site does `parseSafe(CreateSchema, formData)`); injecting the defaults into the FormData itself preserves the schema's existing input contract — no need to rebuild the schema with `s.object` or bypass validation. The form no longer renders `name="repo"` / `name="branch"` inputs (U4), so user-supplied form data never carries them; the controller's set-then-parse pattern is the single source of repo/branch values.
- Update `readPreviousValues` to read only `prompt`. The `PreviousValues` interface narrowing happens in U4 (where `home/page.tsx` is rewritten anyway — keeping the edit in U3 wastes work that U4 will overwrite).
- Update controller-test fixtures:
  - Drop `repo` and `branch` from POST form bodies in the existing tests.
  - Adjust the empty-fields and missing-fields 400 tests — only empty/missing `prompt` (and `idempotencyKey`) drive a 400 now. Repo/branch can never be empty because they're constants injected by the controller.
  - Add a positive assertion: the upstream `createSession` mock receives `body.repo === DEFAULT_REPO` and `body.branch === DEFAULT_BRANCH` on the happy path.
  - Drop the "preserves submitted repo / branch / prompt" assertions for repo/branch; keep the prompt-preservation assertion. Apply the same drop to the sibling test "preserves user-typed values when validation fails on a single empty field" — it also asserts on `value="https://github.com/example/keep-me"` and `value="develop"`; both lines go away (only the prompt-preservation assertion stays).
  - Migrate the "upstream invalid_request" scenario — today it triggers via a non-HTTPS repo URL the user supplies. Since the user can't supply repo anymore, switch the upstream-error trigger to a generic 400 from the API (api returns `code: invalid_request, message: 'something else'`) and assert the page re-renders with the inline error. This keeps the controller's error-handling path under test without requiring user-controlled bad input.

**Patterns to follow:**
- Existing `controller.tsx` shape — schema parse + `parseSafe` + `redirect` / `render` branches.
- Existing `home.controller.test.ts` test fixture conventions.

**Test scenarios:**
- Happy path: POST with valid `prompt` + `idempotencyKey` → controller posts `{ repo: DEFAULT_REPO, branch: DEFAULT_BRANCH, idempotencyKey, prompt }` to `createSession`, redirects to `/sessions/:id`.
- Edge case (empty prompt): POST with empty `prompt` → 400, page re-renders with error.
- Edge case (missing prompt): POST without `prompt` field → 400.
- Edge case (empty idempotencyKey): POST with empty key → controller generates a fresh one and continues (current behavior, preserved).
- Error path (upstream invalid_request): mock upstream returns 400 → controller re-renders with status 400 + inline error message.
- Error path (upstream 503): mock upstream returns 503 → controller re-renders with status 503 + inline error.
- Error path (upstream network error): mock fetch throws → controller re-renders with status 502.
- Integration (idempotency key persists): POST that fails validation → re-render preserves the submitted `idempotencyKey` value.
- Integration (Done banner round-trip): `?done=&repo=&branch=` URL params still render the DoneBanner above the form (untouched). DoneBanner test file does not need updates.
- Integration (`previousValues` preserves prompt): POST with `prompt: 'foo'` + missing idempotencyKey → re-renders with the prompt value visible in the textarea.

**Verification:**
- `pnpm typecheck` passes.
- `pnpm test` — all home controller tests pass with migrated fixtures.

---

### U4. Page rewrite — Hi-Fi composition + chrome migration

**Goal:** Rewrite `home/page.tsx` to the Hi-Fi composition, swap in the new clientEntries from U2, migrate the chrome to crumbs mode, drop the repo/branch UI, and migrate the controller-test pins for the new copy.

**Requirements:** R1, R2, R5, R8

**Dependencies:** U1, U2, U3

**Files:**
- Modify: `services/landing/app/actions/home/page.tsx` (includes `PreviousValues` interface narrowing — drop `repo` and `branch` fields; keep `prompt`)
- Modify: `services/landing/test/actions/home.controller.test.ts` (copy + chrome pins)

**Approach:**

*Layout shell:*
- Switch `<Layout>` to `mainKind='full'` and `topBarChrome={{ mode: 'crumbs', here: 'new app' }}`. Right slot: a small flex row containing a ghost "← Back to apps" link and the `<Avatar />` (mirrors the Ready chrome's `HeaderSlot` shape).
- Drop today's "Cancel" link in the right slot.

*Page body:*
- Banners (DoneBanner + action-error) render *above* the outer 760px wrapper, NOT inside the form's Stack. They span the page width at the same vertical position as today (which puts them between the chrome and the centered hero). This keeps banners a top-of-page concern and stops them from squeezing into the composer's narrower column.
- Outer wrapper: `<div mix={css({ maxWidth: 'var(--w-stage)', marginLeft: 'auto', marginRight: 'auto', width: '100%' })}>` directly inside `<main>` (no `Cover` here — the Create page is naturally top-aligned, not viewport-centered).
- Single `<Stack space="var(--sp-10)">` containing:
  - `<Hero />` — left-aligned wrapper holding the `<h1>` (`var(--fs-display)`, semibold, `--lh-tight`, max-width 760px, left-aligned) and the `<p>` (15.5px, max-width 560px, left-aligned). Drop the `<Eyebrow>`.
  - `<form class="wf-composer">` containing an inner `<Stack space="0">` with:
    - `<textarea>` rendered inline with inline `mix={css({ ... })}` for the borderless 18px-display styling — `border: 0; outline: 0; resize: none; background: transparent; font-family: var(--font-sans); font-size: 18px; line-height: 1.55; color: var(--ink); letter-spacing: -0.005em; min-height: 118px; font-weight: 400` plus `padding: 22px 24px 8px` from the parent `.composer-body` shape (or applied here directly). Render with `autofocus` (lowercase HTML attribute per the JSX-attribute-naming learning — `autoFocus` would be silently lowercased and the browser would ignore the unknown attribute). Carries `previousValues.prompt` as **child text** (NOT `defaultValue=`). Decision: use inline `mix={css(...)}` rather than introducing a `.wf-composer-textarea` recipe — the styling is one-off and not reused elsewhere.
    - `<div class="wf-livesat" data-hidden="">Will live at <span id="lives-at-slug">…</span>.openvoid.dev</div>` (the wrapper is page-owned; `DerivedSlug` updates the inner span and toggles `data-hidden` on the wrapper). The opacity transition lives on the `.wf-livesat[data-hidden]` rule from U1.
    - `<DerivedSlug targetId="prompt" slugId="lives-at-slug" wrapperId="lives-at-wrap" />` (invisible). The wrapperId references a small id added to the `.wf-livesat` div.
    - `<div class="wf-composer-bar">` toolbar band:
      - Cluster of three borderless tool buttons (`.wf-tool`) — Attach, Stack:auto, DB:postgres. All decorative.
      - Spacer, then `<span class="wf-submit-area">` containing the kbd hint (`<span class="wf-keycap">⌘</span><span class="wf-keycap">↵</span> to start`) and `<StartSessionButton targetId="prompt" />`. The kbd hint sits OUTSIDE the button (matches the design's `.kbd-static` placement; the button itself only renders label + arrow SVG per U1's `.wf-btn-go` recipe).
    - `<AutoGrowTextarea targetId="prompt" maxHeight={360} />` (invisible).
    - Hidden inputs: `<input type="hidden" name="idempotencyKey" value={idempotencyKey} />`. No `name="repo"` or `name="branch"` inputs render.
  - `<Alts />` — `<Cluster space="var(--sp-3)" justify="center">` of four `.wf-alt` buttons: "Start from a template", "Import GitHub repo", "Upload codebase (.zip)", "Fork an example". Each wraps an SVG glyph from the design + a label. Decision: render with `data-coming-soon=""` and a `title="Coming soon"` attribute — NOT `disabled`. The `disabled` path defeats the `.wf-alt:hover` style (disabled elements don't fire `:hover`), making the alts row visually inert; `data-coming-soon` keeps hover working and pairs with U1's `.wf-alt[data-coming-soon] { cursor: not-allowed; opacity: 0.85 }` style. The `<button type="button">` carries no click handler so the no-op shape is implicit.
  - `<Suggestions />` — flex row with a lowercase "try" label + `<SuggestionChips />` (now emits the `.wf-sug` class with a `::before` arrow glyph per U1). Migrate `SUGGESTIONS` from short strings to `{label, fill}` pairs from the design:
    - `{ label: 'Notion-style notes', fill: 'A Notion-style note app with markdown, slash commands, and per-page sharing.' }`
    - `{ label: 'URL shortener', fill: 'A URL shortener with custom slugs, click analytics, and a dashboard.' }`
    - `{ label: 'Habit tracker', fill: 'A daily habit tracker with streaks, weekly emails, and a public profile.' }`
    - `{ label: 'Internal admin panel', fill: 'An internal admin panel for our Postgres database with role-based auth.' }`
  - `<Footer />` — `<p class="wf-muted">` with "Provisioning a fresh sandbox usually takes 10–25 seconds. <a class='wf-link' href='#'>What runs in there?</a>" — the link is a parking lot in v1.

*Imports:*
- Drop `SubmitButton` and `Eyebrow` imports.
- Drop the `<details>` / advanced-expander block entirely.
- Drop `Input` import (no longer used).
- Add `StartSessionButton`, `AutoGrowTextarea`, `DerivedSlug` imports.

*Controller tests:*
- Migrate `/What should we build today\?/` → `/Let's make something\./`.
- Migrate `/Step 1 of 1/` removal.
- Add absence pin: `assert.doesNotMatch(html, /name="repo"/)` and `assert.doesNotMatch(html, /name="branch"/)`.
- Add chrome pins: `wf-toolbar-tall` class present, "new app" rendered in mono, "Back to apps" link present.
- Add composer-shape pin: `wf-composer` class on the form.
- Add absence pin for `<details>` expander.

**Patterns to follow:**
- `services/landing/app/actions/sessions/components/ready.tsx` — outer-wrapper-plus-Stack composition; `HeaderSlot`-style right-slot row.
- `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md` — single max-width, no per-row plumbing.
- `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` — render `previousValues.prompt` as textarea child text, audit camelCase HTML attributes.

**Test scenarios:**
- Happy path (chrome): rendered HTML contains `class="wf-toolbar wf-toolbar-tall"`, "new app" in mono, "Back to apps" link, `<Avatar />` markup.
- Happy path (hero): rendered HTML matches `Let's make something\.` and the sub-prose; does NOT match `What should we build today` or `Step 1 of 1`.
- Happy path (composer): rendered HTML contains `<form class="wf-composer">`, the inline textarea with `name="prompt"`, the submit button with class `wf-btn-go`.
- Happy path (alts row): rendered HTML contains four buttons with `class="wf-alt"`, labels matching the design.
- Happy path (suggestions): rendered HTML contains four chip buttons with the new short labels (`/Notion-style notes/`, `/URL shortener/`, etc.).
- Happy path (footer): rendered HTML contains "Provisioning a fresh sandbox" and the parking-lot link.
- Absence pins: rendered HTML does not contain `name="repo"`, `name="branch"`, `<details>`, or "Step 1 of 1".
- Edge case (`previousValues.prompt` round-trip): re-render with `previousValues: { prompt: 'foo bar baz' }` includes `>foo bar baz</textarea>` (child text, not `defaultValue=`).
- Integration (DoneBanner): when controller passes `done`, the banner renders above the composer as today.
- Integration (action-error banner): when controller passes `error`, the inline banner renders above the composer.

**Verification:**
- `pnpm typecheck` passes.
- `pnpm test` — full landing test suite passes (controller tests with migrated pins, clientEntry tests from U2, blocks.css disk-load tests from U1).
- Manual: `pnpm dev` browser visit to `/` confirms the chrome shape, composer interaction (auto-grow on type, slug appearing at 8+ chars, ⌘+Enter submit), suggestion-chip fill behavior, alts row visual, footer prose. Verify `pnpm dev` re-render after a validation failure preserves the typed prompt in the textarea.

---

## System-Wide Impact

- **Interaction graph:** No new server-side pathways. Three new clientEntries attach `input` / `keydown` listeners cleaned up via `handle.signal`. The `StartSessionButton` document-level keydown listener uses the same suppression-on-text-input-focus reasoning as `OpenLinkShortcuts` from PR #25 (skip when an `<input>`, `<textarea>`, or `[contenteditable]` is focused — though for ⌘+Enter the textarea IS the target, so the suppression rule is "skip when focus is in an `<input>` or `[contenteditable]` other than the prompt textarea itself"; simpler: only fire when `(metaKey || ctrlKey) && key === 'Enter'` and the form contains the focused element).
- **Error propagation:** Controller error-handling unchanged — validation failure → 400 + re-render; upstream ApiError → status passthrough + re-render; network errors → 502 (existing).
- **State lifecycle risks:** No new persistence. Auto-grow timer is implicit (browser layout); slug-derivation is synchronous on input. No teardown bugs to engineer around.
- **API surface parity:** Three new exported clientEntries; one removed (`SubmitButton`); `SuggestionChips` widens its prop type (one consumer migrates). `PreviousValues` interface narrows to `{ prompt?: string }` only.
- **Form contract:** Form submits `{ prompt, idempotencyKey }` only. Controller injects `{ repo, branch }` defaults. Upstream Session-API call shape unchanged.
- **CSS architecture:** Five new recipes in `blocks.css`; no `@layer` / cascade-order changes. Token usage stays within the existing token set (no new tokens needed).
- **Integration coverage:** The full controller round-trip (form → validation → upstream API → redirect, plus re-render-with-error) is covered by the existing controller test with migrated fixtures. The DoneBanner round-trip is unchanged.
- **Unchanged invariants:** Idempotency-key plumbing, DoneBanner contract, `?done=&repo=&branch=` URL-params shape, Session-API request body shape, asset-server allow-list, layout primitives' APIs.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `DEFAULT_REPO` placeholder URL must be a URL the upstream Session API accepts. If the API tries to clone and the repo doesn't exist, sessions fail to provision in production. | Implementation-time decision deferred to U3. Likely: a maintained empty `https://github.com/openvoid/scratch` repo, or an env var resolved at boot. If the API has a tighter constraint, surface that as a follow-up before merge. |
| `<textarea>` rendered inline with `previousValues.prompt` — using `defaultValue=` instead of child text would silently break prompt re-population on validation re-render (Remix 3 SSR lowercases unrecognized camelCase attributes). | Per the JSX-attribute-naming learning. U4 explicitly tests the round-trip via a controller-test scenario. PR review checklist: grep for `defaultValue=` on the inline textarea. |
| `StartSessionButton`'s ⌘+Enter listener could fire when the user is mid-shortcut in a different focus context (browser dev tools, extension shortcuts). | Listener is gated by `(metaKey || ctrlKey) && key === 'Enter'` AND the form's focus contains the active element. Out-of-form focuses don't trigger. |
| Five new CSS recipes increase the surface that future redesigns must reckon with. The composer / btn-go / tool / alt are all single-consumer in v1. | Acceptable cost; the recipes align with the canonical OpenVoid Tokens design and are likely to be reused (alts will recur in any "starting points" UI; tool will recur in any composer; btn-go is a candidate for a primary-action recipe across the app). |
| Removing the repo/branch advanced expander breaks any user who was relying on it to bootstrap a session against their own repo. | v1 explicitly accepts this. Repo selection is deferred to a later plan. The Session API still accepts a repo URL — it's just not user-supplied for now. |
| Controller-test migration is invasive (drops 5+ assertions, adds 5+ new ones). | Migration lives in U3 (controller-side) and U4 (page-side) — split keeps each commit focused. Existing test scaffolding (fake fetch mock, `t.mock.method`) doesn't change. |
| The lowercase `try` label + flat `.wf-alt` pill row look similar to the alts row above; users may conflate "alternative entry points" and "suggestions". | Visual differentiation: alts use `.wf-alt` (32px tall, paper-2, with SVG glyphs), suggestions use chip-style (or a smaller variant); the "try" label disambiguates. Manual `pnpm dev` check at narrow widths to confirm the rows read distinctly. |

---

## Documentation / Operational Notes

- No runtime config, env, or dependency changes (unless `DEFAULT_REPO` becomes an env var at U3 implementation — at which point note in README and any deployment runbook).
- Manual verification path: `pnpm dev`, navigate to `/`. Verify the chrome (56px crumbs, "maria / new app", "Back to apps" link, Avatar), hero copy + left-alignment, composer focus halo, ⌘+Enter shortcut, auto-grow textarea, derived "lives at <slug>" line appearing at 8+ chars and updating live, suggestion-chip fill behavior (label vs full prompt text), alts row visual, footer parking-lot link. POST a valid prompt to confirm redirect to `/sessions/:id`. POST an invalid prompt (1-2 chars) to confirm 400 + prompt round-trip.
- Capture the auto-grow textarea pattern and the ⌘+Enter shortcut binding pattern as new `docs/solutions/` learnings post-merge — both are reusable and undocumented (per the learnings-researcher's recommendation).
- The previous landing-page-redesign plan (`docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md`) framed wireframe variant 02-B as the visual direction for Create; this plan supersedes that direction.

---

## Sources & References

- **Design (canonical)**: `docs/designs/Create Prompt Hi-Fi.html`
- **Tokens (canonical)**: `docs/designs/OpenVoid Tokens.html`
- **Page being revised**: `services/landing/app/actions/home/page.tsx`
- **Controller**: `services/landing/app/actions/home/controller.tsx`
- **Composition reference (just-merged peer)**: `services/landing/app/actions/sessions/components/ready.tsx`
- **Predecessor plan (superseded direction)**: `docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md`
- **Ready redesign plan (immediate predecessor; established chrome + recipes)**: `docs/plans/2026-05-09-002-feat-ready-page-redesign-plan.md`
- **Layout-primitive composition learning**: `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md`
- **JSX attribute-naming learning**: `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md`
- **Related code**:
  - `services/landing/app/ui/{layout,top-bar,card,avatar,logo,document}.tsx`
  - `services/landing/app/ui/layout/{stack,cluster,cover}.tsx`
  - `services/landing/public/styles/{tokens,blocks,exceptions,composition}.css`
  - `services/landing/app/actions/home/client/{submit-button,suggestion-chips}.tsx` (the former replaced; the latter widened)
  - `services/landing/app/actions/sessions/client/{copy-button,open-link-shortcuts}.tsx` (clientEntry shape references)
  - `services/landing/test/actions/home.controller.test.ts` (test migration target)
- **External methodology references**:
  - Every Layout (https://every-layout.dev/) — Stack, Cluster
  - CUBE CSS (https://cube.fyi/) — composition / block layer separation
