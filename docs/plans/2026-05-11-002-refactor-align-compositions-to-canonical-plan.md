---
title: Align landing compositions/ layer to canonical Compositions taxonomy
type: refactor
status: active
date: 2026-05-11
---

# Align landing compositions/ layer to canonical Compositions taxonomy

## Summary

Audit `services/landing/public/styles/compositions/` (13 files from
plan 2026-05-11-001's U1 move) against the canonical 18-composition
taxonomy in `docs/designs/OpenVoid Compositions.html`. Reclassify
5 misclassified leaves back to `blocks/`, split `surface.css` into
its block-leaf and composition pieces, rename `.wf-composer*` to
canonical `.composer*` and absorb `livesat.css` into it (it's the
Composer's "Derived row" zone, not its own composition), and document
the 3 Ready-page non-canonical extensions with header comments.
Forward-looking canonical compositions with no current consumer
(Stage, Page Heading, Info Grid, Footer Bar, etc.) stay un-scaffolded
per the "no empty stubs" rule established last cycle.

---

## Problem Frame

Plan 2026-05-11-001's U1 (PR #27) moved 13 files into `compositions/`
verbatim — a deliberately mechanical move with no taxonomy judgment.
The canonical Compositions doc just landed (`docs/designs/OpenVoid
Compositions.html`), and it makes clear that several of those 13 files
are actually leaf display primitives (app-icon, icon-mark, spinner,
skeleton, progress) and that `surface.css` is heterogeneous (mixing
the Card Shell composition with leaf card surfaces and background
patterns). Three other files (connector, split-tip, url-row) are
Ready-page features the canonical doc doesn't define at all —
non-canonical product extensions. Without reconciliation, the
`compositions/` folder ships with mixed semantics and the next
contributor has to re-derive these decisions.

---

## Requirements

- R1. Files currently in `compositions/` that are leaf display primitives
  (app-icon, icon-mark, spinner, skeleton, progress) move back to `blocks/`
- R2. `compositions/surface.css` splits: `.wf-card-elev` becomes the
  canonical `.card-shell` composition (renamed file, renamed selector,
  `wf-` dropped); `.wf-card`, `.wf-hairline`, and bg patterns return to
  `blocks/`
- R3. `compositions/composer.css` adopts canonical bare selectors
  (`.composer`, `.composer-bar`, `.composer-submit-area`,
  `.composer-submit-hint`) and absorbs `livesat.css` as the Composer's
  "Derived row" zone
- R4. The three Ready-page extensions (connector, split-tip, url-row)
  get header comments explicitly marking them as non-canonical product
  features awaiting future canonical absorption
- R5. `document.tsx`'s `BLOCK_FILES` / `COMPOSITION_FILES` arrays reflect
  the new file layout; `blocks.test.ts` directory assertions stay green
- R6. Every JSX consumer of a renamed class is updated; tests pass
  (currently 195/195) and typecheck clean

---

## Scope Boundaries

- No edits to `tokens.css`, `global.css`, `composition.css` (singular)
- No scaffolding of canonical compositions with no current JSX consumer:
  Stage, Page Heading, Info Grid, Asymmetric Sidebar (the canonical doc's
  full pattern), Attached Artifact Card, File Header Strip, GitHub Input
  Panel, Stack Detection Card, Verdict Banner, Footer Bar
- No new width tokens (`--w-prose`/`--w-stage`/`--w-page`) — defer until
  a consumer needs them
- `.wf-toolbar` and `.wf-toolbar-tall` stay `wf-` prefixed in this PR
  (they're a non-canonical chrome implementation of App Shell's header;
  the right home is "fold into an App Shell composition" but that's a
  future PR)
- No rename of `composition.css` → `layout-primitives.css` (still deferred)
- No canonical alignment of the 8 deferred blocks units (`.btn-pri` /
  `.field` / `.kbd` / `.pill` / `.eyebrow` / `.alt` / chip retirement /
  eyebrow structural shift) — those belong to plan 2026-05-11-001's
  unfinished U2-U8

### Deferred to Follow-Up Work

- App Shell composition adoption (absorbs `.wf-toolbar` family): future PR
- Canonical block renames (plan 2026-05-11-001 U2-U8): future PR
- Scaffolding the forward-looking canonical compositions when a feature
  actually consumes them: future PRs

---

## Implementation Units

### U1. Reclassify 5 misclassified leaves back to `blocks/`

**Goal:** Move `app-icon.css`, `icon-mark.css`, `spinner.css`,
`skeleton.css`, `progress.css` from `compositions/` back to `blocks/`.
These are leaf display primitives — single-purpose visual atoms used
INSIDE other compositions, not compositions themselves.

**Files:**
- Move: `services/landing/public/styles/compositions/{app-icon,icon-mark,spinner,skeleton,progress}.css` → `services/landing/public/styles/blocks/<same-name>.css` (via `git mv`)
- Modify: `services/landing/app/ui/document.tsx` — add these 5 names back to `BLOCK_FILES`, remove from `COMPOSITION_FILES`
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — update the two directory-content assertions (`compositions/` expected list shrinks from 13 to 8; `blocks/` shouldn't-hold-these list shrinks accordingly)

**Test scenarios:**
- Happy path: `npm test` still 195/195 after the move
- Layout assertion: `compositions/` now holds 7 files (was 13: 5 leaves leave + livesat merges into composer in U3 + surface splits in U2); `blocks/` gains 5 leaves
- Document.tsx assertion: BLOCK_FILES contains the 5 returned names; COMPOSITION_FILES does not

**Verification:**
- `compositions/` no longer contains app-icon, icon-mark, spinner, skeleton, progress
- `blocks/` contains them
- Tests + typecheck pass

### U2. Split `compositions/surface.css` — extract `.card-shell`, return leaves to `blocks/`

**Goal:** `compositions/surface.css` is heterogeneous: `.wf-card-elev` is
the canonical Card Shell composition (multi-zone, shadow-2 elevated
surface); `.wf-card` and `.wf-hairline` are leaf bordered surfaces; and
`.wf-bg-alt`/`.wf-grid-bg`/`.wf-stripe-bg` are background-pattern
utilities. Split this into a focused `compositions/card-shell.css`
(canonical-renamed) plus `blocks/surface.css` (the leaf surfaces and
patterns).

**Files:**
- Create: `services/landing/public/styles/compositions/card-shell.css` (extract `.wf-card-elev` rule + `.wf-card-elev > .stack` cross-layer combinator + `:hover` rule; rename selectors `wf-card-elev` → `card-shell`)
- Create: `services/landing/public/styles/blocks/surface.css` (extract `.wf-card`, `.wf-hairline`, `.wf-bg-alt`, `.wf-grid-bg`, `.wf-stripe-bg` — keep `wf-` prefix for now; non-canonical leaf surfaces)
- Delete: `services/landing/public/styles/compositions/surface.css`
- Modify: `services/landing/app/ui/document.tsx` — drop `surface` from COMPOSITION_FILES, add `card-shell` to COMPOSITION_FILES, add `surface` to BLOCK_FILES
- Modify: `services/landing/app/actions/sessions/components/ready.tsx` (and any other consumer): `class="wf-card-elev"` → `class="card-shell"`
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — update directory assertions; selector-content assertions still pass via concatenation
- Modify: comment in `services/landing/app/ui/card.tsx` referencing `wf-card-elev`

**Test scenarios:**
- Happy path: Ready page renders identically (Card Shell + inner Stack work the same way)
- Cross-layer combinator: `.card-shell > .stack { flex: 1 }` continues to make the bottom-row alignment work in paired cards
- Visual smoke: side-by-side Cards on Ready page still align their bottom URL+button rows

**Verification:**
- `compositions/surface.css` gone; `compositions/card-shell.css` exists
- `blocks/surface.css` exists with the leaf surfaces and bg patterns
- `grep -r "wf-card-elev" services/landing` returns zero matches
- Tests + typecheck pass

### U3. Rename `compositions/composer.css` to canonical `.composer` + absorb `livesat.css`

**Goal:** Canonical Composer is selector `.composer` per `OpenVoid
Compositions.html`. Drop `wf-` prefix on every composer-family selector
(`.wf-composer`, `.wf-composer-bar`, `.wf-submit-area`, `.wf-submit-hint`).
Merge `livesat.css` contents into `composer.css` — the "Lives at" subline
is the canonical Composer's "Derived row" zone, not a separate composition.
Update every JSX consumer.

**Files:**
- Modify: `services/landing/public/styles/compositions/composer.css` — drop `wf-` prefix on all selectors; append the merged livesat rules (`.composer-livesat`, `.composer-livesat[data-hidden]`, `.composer-livesat-prefix`, `.composer-livesat-name`)
- Delete: `services/landing/public/styles/compositions/livesat.css`
- Modify: `services/landing/app/ui/document.tsx` — drop `livesat` from COMPOSITION_FILES
- Modify (JSX consumers, drop `wf-` prefix):
  - `services/landing/app/actions/home/page.tsx` — every `wf-composer*` / `wf-submit-*` / `wf-livesat*` reference
  - `services/landing/app/actions/home/client/start-session-button.tsx` — `wf-submit-area`/`wf-submit-hint`
  - `services/landing/app/actions/home/client/derived-slug.tsx` — `wf-livesat*` references
  - Anywhere else grep surfaces
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — update composer-file path read; update selector assertions for the renamed selectors
- Modify (doc comments): `start-session-button.tsx`, `derived-slug.tsx`, `suggestion-chips.tsx` references to composer

**Test scenarios:**
- Happy path: Create page composer renders identically; focus-within halo, submit bar, lives-at slug, derived-name fade all work
- Edge case: derived-slug `data-hidden` toggle still fades in/out via the merged `.composer-livesat[data-hidden]` rule
- Regression: blocks.test.ts asserts on the canonical `.composer`-prefixed selectors; legacy `wf-composer*` strings no longer appear in CSS or JSX

**Verification:**
- `grep -r "wf-composer\|wf-submit-\|wf-livesat" services/landing` returns zero matches
- `compositions/livesat.css` is gone; its contents inside `composer.css`
- Tests + typecheck pass; manual smoke of Create page

### U4. Document non-canonical extensions with header comments

**Goal:** Add a clarifying header comment to four files that need
contextualization for future readers: the three Ready-page extensions
(`connector.css`, `split-tip.css`, `url-row.css`) which aren't in the
canonical doc, and `toolbar.css` which is a chrome implementation of
App Shell's header (the canonical Toolbar Row is different — it's the
Composer's submit bar, already inside composer.css).

**Files:**
- Modify: `services/landing/public/styles/compositions/connector.css` (prepend header comment)
- Modify: `services/landing/public/styles/compositions/split-tip.css` (prepend header comment)
- Modify: `services/landing/public/styles/compositions/url-row.css` (prepend header comment)
- Modify: `services/landing/public/styles/compositions/toolbar.css` (prepend header comment clarifying App Shell vs canonical Toolbar Row)

**Test scenarios:**
- Test expectation: none — pure documentation, no behavioral change

**Verification:**
- Each file has a header comment naming it as non-canonical (or distinct from canonical Toolbar Row, for toolbar.css) with a brief rationale

### U5. Run tests + typecheck, push, open stacked PR

**Goal:** Ship the work as a stacked PR atop `refactor/landing-css-canonical-alignment` (PR #27).

**Files:**
- N/A (CI / git operations only)

**Test scenarios:**
- `npm test` passes from `services/landing/` (target: 195+/195+ — directory-content assertions may shift counts)
- `npm run typecheck` clean
- `gh pr create --base refactor/landing-css-canonical-alignment` succeeds

**Verification:**
- PR opened with `--base refactor/landing-css-canonical-alignment` so it merges after #27
- PR description references #27 as prerequisite
- All tasks marked completed

---

## Sources & References

- **Canonical design doc:** `docs/designs/OpenVoid Compositions.html`
- **Prior plan:** `docs/plans/2026-05-11-001-refactor-align-landing-blocks-to-canonical-plan.md` (U1 shipped in PR #27; U2-U8 still deferred)
- **Stacked atop:** PR #27 (`refactor/landing-css-canonical-alignment`)
