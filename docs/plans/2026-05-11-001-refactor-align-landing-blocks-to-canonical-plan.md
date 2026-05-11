---
title: Align landing blocks layer to canonical Blocks taxonomy
type: refactor
status: completed
date: 2026-05-11
---

# Align landing blocks layer to canonical Blocks taxonomy

## Summary

Rename and restyle the `services/landing/public/styles/blocks/` files that have a counterpart in the canonical `docs/designs/OpenVoid Blocks.html` taxonomy (drop the `wf-` prefix, match the documented recipe), move composition-shaped files into a new sibling `services/landing/public/styles/compositions/` folder for the next PR to address, retire blocks with no canonical counterpart by routing their consumers to a canonical block, and update every JSX call site and test pinned to the old class names. Non-canonical utilities (animations, a11y, dot helper, typography helpers) keep their `wf-` prefix.

---

## Problem Frame

The landing service's blocks layer was authored before the canonical `OpenVoid Blocks.html` design-system spec existed. As the canonical doc has solidified (21 blocks across Shell, Labels & Status, Buttons & Actions, Inputs, Display Primitives, Terminal), the implementation has drifted: button shapes don't match canonical heights and radii, the input recipe is 2px short of canonical and uses a real border instead of an inset shadow (now fixed in this session), pills and eyebrows use a typography-style label where the canonical spec calls for a pill shape, and several files in `blocks/` are actually compositions of blocks (Composer, Cards, Connector) — the canonical doc explicitly punts those to a sibling Compositions document. Without alignment, every new feature builds on a non-canonical foundation that future designs will have to fight against.

---

## Requirements

- R1. Every CSS class with a canonical counterpart in `docs/designs/OpenVoid Blocks.html` is renamed to the canonical bare selector (no `wf-` prefix) and matches the canonical recipe (height, padding, radius, font, paint, focus model)
- R2. Composition-shaped files (Composer, Cards, Connector, Toolbar, App Icon, Spinner, Progress, Skeleton, Live-At, Suggestion, Icon Mark, URL Row, Split Tip) move verbatim into `services/landing/public/styles/compositions/` with their `wf-` prefix retained for the next PR to address
- R3. Blocks with no canonical counterpart are either rerouted to a canonical block (e.g., `wf-chip` → `.btn-ghost`) or kept as non-canonical utilities with a clear comment explaining why (`animations.css`, `visually-hidden.css`, `dot.css`)
- R4. Every JSX consumer in `services/landing/app/` is updated to the new class names; no stale `wf-*` references remain for renamed-or-moved blocks
- R5. The existing 192 tests continue to pass; selector-pinned assertions in `test/ui/styles/blocks.test.ts` are updated to the new selector list and read from both `blocks/` and `compositions/`
- R6. `app/ui/document.tsx` loads the `compositions/*.css` files between `blocks/*.css` and `exceptions.css` so a composition can override a block when needed
- R7. The `focus-ring.css` composite is updated to reference the new canonical selectors (`.btn-pri`, `.btn-sec`, `.btn-ghost`, `.field`, `.alt`) so keyboard focus continues to work everywhere

---

## Scope Boundaries

- No edits to `tokens.css`, `composition.css`, or `global.css`
- No restyling or renaming of files moved into `compositions/` — that's the next PR
- No dropping of `wf-` prefix on non-canonical utilities (typography helpers, animations, a11y, dot)
- No scaffolding of canonical blocks not currently consumed by any JSX (Brand Mark, Crumbs, Avatar, Segmented Control, Stack Tag, Domain Chip, Info Note Card, Drop Zone, Terminal, Mono Field, Select)
- No changes to the rendered visual output beyond what's strictly required by canonical alignment (height adjustments, radius corrections, paint swaps where current and canonical disagree)

### Deferred to Follow-Up Work

- Aligning the moved compositions to a forthcoming `docs/designs/OpenVoid Compositions.html` (separate PR after that doc lands)
- Moving the layout primitives `.wf-row` / `.wf-col` / `.wf-spacer` / `.wf-divider` from `blocks/layout.css` into `composition.css` (out of stated scope; they're CUBE Composition-tier primitives sitting in the wrong layer)
- Splitting the inner contents of `surface.css` (the basic `.wf-card` and `.wf-hairline` are leaf-shaped while `.wf-card-elev` is composition-shaped) — defer to the compositions PR
- Renaming `composition.css` (singular, CUBE layout primitives) to disambiguate from the new `compositions/` folder (plural, OpenVoid composition tier) — terminology overlap is documented but a rename is out of scope here
- Adding a `.danger` paint variant to canonical `.eyebrow` — currently consumers express danger-tone via `mix={css({ color: ... })}` overrides; whether the canonical pill should grow a `.danger` paint variant is a design decision for the design-system author

---

## Context & Research

### Relevant Code and Patterns

- `services/landing/public/styles/blocks/` — 26 files to audit; 13 stay (renamed/restyled), 13 move to `compositions/`
- `services/landing/public/styles/compositions/` — new folder created in U1
- `services/landing/app/ui/document.tsx` — `BLOCK_FILES` array drives the `<link>` cascade; needs a parallel `COMPOSITION_FILES` array and an inserted `compositions/*.css` slot
- `services/landing/app/ui/eyebrow.tsx` — `<Eyebrow>` JSX component; structural change in U6 to emit the canonical pill shape with optional dot
- `services/landing/app/ui/button.tsx` — `<Button>` JSX component; variant matrix collapses in U2
- `services/landing/app/ui/input.tsx`, `app/ui/textarea.tsx` — already use the canonical `.field` recipe shape after this session's input refactor; remaining work is just the rename
- `services/landing/app/actions/sessions/client/copy-button.tsx` — only consumer of `wf-chip`; reroutes to `.btn-ghost` in U2
- `services/landing/app/actions/sessions/client/focus-h1.tsx` — already updated this session (no class dependency)
- `services/landing/test/ui/styles/blocks.test.ts` — selector-pinned assertions; updated unit-by-unit, with a final consolidation pass in U8
- `services/landing/test/ui/document.test.tsx` — link-tag order assertions; updated in U1 when the cascade gains `compositions/`

### Institutional Learnings

- `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` — codebase consistently uses `class="..."` (not `className=`); confirmed via grep that no `className=` usages exist in the affected JSX
- `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md` — references `.wf-card-elev` and `.wf-btn-action-pri` examples that go stale after this refactor; capture a successor learning with `/ce-compound` after merge
- The descendant combinator `.wf-card-elev > .stack { flex: 1 }` (currently in `surface.css`) is a cross-layer coupling between blocks and CUBE composition — must survive the move into `compositions/` verbatim

### External References

- `docs/designs/OpenVoid Blocks.html` — canonical taxonomy; source of truth for every rename/restyle decision
- `docs/designs/OpenVoid Tokens.html` — canonical paint, focus-ring, and recipe primitives that the renamed blocks consume

---

## Key Technical Decisions

- **Rename via direct find-replace, not class aliasing.** Each renamed selector is updated in CSS *and* every JSX consumer in the same unit. No transitional aliases (no `.btn-pri, .wf-btn-pri` block); aliasing would entrench the old name and defer the cleanup forever.
- **Cascade: `compositions/*.css` loads after `blocks/*.css` and before `exceptions.css`.** Compositions assemble blocks and may need to override a block default (e.g., a Composer's textarea sits inside a focused surface, suppressing the textarea's own ring). Loading compositions after blocks honors that direction.
- **Compositions keep their `wf-` prefix in this PR.** Renaming them now would create churn in code the next PR will touch anyway. The next PR's canonical Compositions doc will dictate their final names.
- **`.tool` is treated as a `.btn-ghost` alias, per canonical (`.btn-ghost / .tool`).** Implementation: extend `.btn-ghost` to handle the inline-mono `.tool-key` slot; `tool.css` becomes a tiny extension file or merges into `button.css`. Decision deferred to U2.
- **Pills split into TWO canonical blocks.** `wf-pill-live` / `wf-pill-ready` (in-header status indicators) → `.pill` / `.pill.live` (Status Pill block). The typography `wf-eyebrow` (label-above-title) → `.eyebrow` (Eyebrow Pill block). Different intent, different shape, different unit.
- **`wf-chip` retired with consumer reroute.** Single consumer (copy-button) becomes `.btn-ghost`. The chip recipe (smaller, bordered, capitalized) is the third pill-like shape with no canonical home; retiring it stops the proliferation.
- **Test discipline: blocks.test.ts grows to read both `blocks/` and `compositions/` directories.** Keep selector-pinned assertions but update the list per unit.
- **`.wf-eyebrow` is renamed away in U6.** The bare `.eyebrow` is reserved for the canonical Eyebrow Pill. The remaining typography use cases that can't pillify get inline `mix={...}` styles or a different utility class — case-by-case in U6.

---

## Open Questions

### Resolved During Planning

- **Move compositions vs leave with comment?** Move (per user feedback during synthesis).
- **Drop `wf-` prefix on canonical-aligned blocks?** Yes (per user feedback during synthesis).
- **Scaffold canonical blocks not yet consumed?** No (per user feedback during synthesis).
- **Where does the `.tool` recipe live?** Merged into `button.css` as a `.btn-ghost` extension — see U2 approach.
- **Cascade slot for `compositions/`?** After `blocks/`, before `exceptions.css` — see Key Technical Decisions.

### Deferred to Implementation

- **Whether `.eyebrow` needs a `.danger` paint variant.** Current code uses `mix={css({ color: 'var(--wf-danger)' })}` overrides on the typography eyebrow. The canonical doc only spec's `.ok` variant. U6 should evaluate per-call-site whether `.danger` is needed enough to add to the canonical recipe (and if so, surface to design before adding); otherwise keep inline `mix` overrides.
- **Whether `dot.css` (`<StatusDot>` consumer) survives or is absorbed.** Canonical doc has dots only as nested children inside `.eyebrow .dot` and `.pill .d`. Standalone `<StatusDot>` callers may all be reroutable to a pill — defer the audit to U8 cleanup pass.
- **Whether `focus-ring.css` composite stays in `blocks/` or moves to `compositions/`.** It crosses files in both layers; semantically it belongs to whichever layer ships interactive surfaces. Likely stays in `blocks/` (loaded last among blocks) but reassessed in U8.

---

## Output Structure

```text
services/landing/public/styles/
├── utopia.css                 # unchanged
├── tokens.css                 # unchanged
├── global.css                 # unchanged
├── composition.css            # unchanged (CUBE layout primitives — stack, cluster, grid, …)
├── blocks/                    # canonical-aligned, bare selectors
│   ├── alt.css                # → .alt
│   ├── button.css             # → .btn-pri, .btn-sec, .btn-ghost (+ .tool alias)
│   ├── eyebrow.css            # → .eyebrow (replaces typography wf-eyebrow + structural shift)
│   ├── field.css              # → .field (renamed from input.css)
│   ├── focus-ring.css         # composite, updated selector list
│   ├── kbd.css                # → .kbd (renamed from keycap.css)
│   ├── pill.css               # → .pill / .pill.live / .pill.prod
│   ├── animations.css         # non-canonical (kept as-is)
│   ├── dot.css                # non-canonical (kept as-is, possibly retired in U8)
│   ├── layout.css             # non-canonical primitives (kept; deferred to follow-up)
│   ├── typography.css         # non-canonical helpers (.wf-mono, .wf-link, .wf-muted, .wf-faint)
│   └── visually-hidden.css    # a11y utility (kept as-is)
└── compositions/              # NEW — wf-* prefix retained for next PR
    ├── app-icon.css
    ├── composer.css
    ├── connector.css
    ├── icon-mark.css
    ├── livesat.css
    ├── progress.css
    ├── skeleton.css
    ├── spinner.css
    ├── split-tip.css
    ├── suggestion.css
    ├── surface.css
    ├── toolbar.css
    └── url-row.css
```

The per-unit `**Files:**` sections remain authoritative; the tree above is a scope declaration.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Block-to-canonical mapping (the spine of the refactor):**

| Current file / class | Canonical block (`OpenVoid Blocks.html`) | New file / class | Unit |
|---|---|---|---|
| `blocks/button.css` `.wf-btn` + `.wf-btn-pri` | Button: Primary `.btn-pri` | `blocks/button.css` `.btn-pri` | U2 |
| `blocks/button.css` `.wf-btn-action-pri` | (duplicate of Primary) | retired into `.btn-pri` | U2 |
| `blocks/button.css` `.wf-btn-go` | (duplicate of Primary) | retired into `.btn-pri` | U2 |
| `blocks/button.css` `.wf-btn` + `.wf-btn` (sec-shape) | Button: Secondary `.btn-sec` | `blocks/button.css` `.btn-sec` | U2 |
| `blocks/button.css` `.wf-btn-action-sec` | (duplicate of Secondary) | retired into `.btn-sec` | U2 |
| `blocks/button.css` `.wf-btn-ghost` | Button: Ghost `.btn-ghost` | `blocks/button.css` `.btn-ghost` | U2 |
| `blocks/button.css` `.wf-btn-danger` | (no canonical) | `.btn-sec.danger` paint modifier | U2 |
| `blocks/tool.css` `.wf-tool` | Button: Ghost (`.btn-ghost / .tool`) | merged into `blocks/button.css` as `.btn-ghost` recipe + `.tool-key` slot | U2 |
| `blocks/chip.css` `.wf-chip` (+ paint variants) | (no canonical — retired) | consumers reroute to `.btn-ghost` | U2 |
| `blocks/input.css` `.wf-input` | Text Field `.field` | `blocks/field.css` `.field` | U3 |
| `blocks/keycap.css` `.wf-keycap` | Keyboard Badge `.kbd` | `blocks/kbd.css` `.kbd` | U4 |
| `blocks/pill.css` `.wf-pill-live` / `.wf-pill-ready` / `.wf-pill-dot` | Status Pill `.pill / .pill.live / .pill.prod` | `blocks/pill.css` `.pill` (+ `.live`, `.prod`) with nested `.d` | U5 |
| `blocks/typography.css` `.wf-eyebrow` | Eyebrow Pill `.eyebrow` | `blocks/eyebrow.css` `.eyebrow` (+ `.ok`) — STRUCTURAL SHIFT from typography to pill | U6 |
| `blocks/alt.css` `.wf-alt` (+ `[data-coming-soon]`) | Alt Pill `.alt / .alt.on` | `blocks/alt.css` `.alt` (+ `.on`) | U7 |
| `blocks/composer.css` etc. (13 files) | (composition tier) | `compositions/<same-name>.css` (verbatim) | U1 |

**Cascade order after the refactor** (`document.tsx` link sequence):

```
utopia.css
  ↓
tokens.css
  ↓
global.css
  ↓
composition.css            (CUBE layout primitives — unchanged)
  ↓
blocks/*.css               (renamed canonical blocks + retained non-canonical helpers)
  ↓
compositions/*.css         (NEW slot — composition-shaped files moved here)
  ↓
exceptions.css
```

The ordering decision is intentional: a composition (e.g., the Composer surface with its own `:focus-within` halo) sometimes needs to override a block default (e.g., the inner `.field`'s outer halo, which is clipped by composer overflow). Loading `compositions/` after `blocks/` lets that override happen without `!important`.

---

## Implementation Units

### U1. Establish `compositions/` folder and move composition-shaped files verbatim

**Goal:** Create `services/landing/public/styles/compositions/`, move 13 composition-shaped files into it without renaming or restyling, update the cascade, and update tests so the move is invisible to rendered output.

**Requirements:** R2, R5, R6

**Dependencies:** None

**Files:**
- Create directory: `services/landing/public/styles/compositions/`
- Move (verbatim): `services/landing/public/styles/blocks/{app-icon,composer,connector,icon-mark,livesat,progress,skeleton,spinner,split-tip,suggestion,surface,toolbar,url-row}.css` → `services/landing/public/styles/compositions/<same-name>.css`
- Modify: `services/landing/app/ui/document.tsx` — add `COMPOSITION_FILES` array; emit `<link rel="stylesheet" href="/styles/compositions/<name>.css">` after the blocks slot and before exceptions
- Modify: `services/landing/test/ui/document.test.tsx` — extend `STYLE_LINK_ORDER` with at least one `compositions/` file; add an assertion that every composition link sits between the last block link and `exceptions.css`
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — read both `blocks/` and `compositions/` directories when concatenating CSS for cross-file selector assertions; update the legacy file-path-existence checks to permit the new location
- Modify: `services/landing/README.md` — refresh the styles tree to show the new `compositions/` folder
- Modify (doc comments only): any `.tsx` files whose comments cite `blocks.css` or `blocks/<file>.css` for a moved file (`connector.tsx`, `url-row.tsx`, `suggestion-chips.tsx`, `ready.tsx`)

**Approach:**
- Move files verbatim; do not edit CSS contents
- The `wf-card-elev > .stack` descendant combinator (currently in `blocks/surface.css`, soon `compositions/surface.css`) crosses into `composition.css`'s `.stack-split` mechanism — verify by re-rendering the Ready page that the bottom-row alignment between paired cards still works
- Surface that the new `compositions/` folder name overlaps with the existing `composition.css` filename (CUBE layout primitives); add a one-line comment at the top of `compositions/composer.css` explaining the distinction so future readers don't trip
- Keep all `wf-` prefixes intact in the moved files; the next PR addresses canonical naming for compositions

**Patterns to follow:**
- `services/landing/app/ui/document.tsx` — current `BLOCK_FILES` array iteration pattern; mirror it for `COMPOSITION_FILES`

**Test scenarios:**
- Happy path: every previously-passing test still passes after the move (no behavioral change). Run `npm test` and `npm run typecheck` from `services/landing/`
- Integration: the live composer focus halo, the connector flow animation, and the Ready page's two-card bottom alignment all render identically before and after the move (visual smoke; no automated assertion needed beyond the existing tests)
- `document.test.tsx` cascade assertion: every `/styles/compositions/<name>.css` link appears AFTER the last `/styles/blocks/<name>.css` link and BEFORE `/styles/exceptions.css`
- `blocks.test.ts` directory read: assertion that the concatenated CSS still contains every selector previously asserted (no selector dropped during the move)

**Verification:**
- `services/landing/public/styles/blocks/` contains 13 files (was 26)
- `services/landing/public/styles/compositions/` contains 13 files
- `npm test` passes 192/192 with cascade assertions extended to compositions
- Visual spot-check: composer focus halo, connector animation, and Ready card alignment unchanged

---

### U2. Collapse buttons to canonical `.btn-pri` / `.btn-sec` / `.btn-ghost` (+ `.tool` alias, retire chip)

**Goal:** Replace the four-skeleton button taxonomy (`wf-btn`, `wf-btn-action`, `wf-btn-go`, `wf-tool`) with the canonical three (`.btn-pri`, `.btn-sec`, `.btn-ghost`); merge `.tool` into `.btn-ghost` per the canonical alias (`.btn-ghost / .tool`); retire `.wf-chip` by routing its sole consumer to `.btn-ghost`.

**Requirements:** R1, R3, R4, R7

**Dependencies:** U1 (clears the deck so button.css isn't competing with composition-shaped files for attention)

**Files:**
- Modify: `services/landing/public/styles/blocks/button.css` — three canonical recipes from `OpenVoid Blocks.html` lines 127–141; include the `.tool-key` mono slot inside `.btn-ghost`; add `.btn-sec.danger` paint modifier (red text on white card with line border)
- Delete: `services/landing/public/styles/blocks/tool.css`
- Delete: `services/landing/public/styles/blocks/chip.css`
- Modify: `services/landing/public/styles/blocks/focus-ring.css` — replace `.wf-btn`, `.wf-btn-action`, `.wf-btn-go`, `.wf-tool`, `.wf-chip` with `.btn-pri`, `.btn-sec`, `.btn-ghost`
- Modify: `services/landing/app/ui/document.tsx` — drop `tool` and `chip` from `BLOCK_FILES`
- Modify: `services/landing/app/ui/button.tsx` — variant matrix collapses; `primary` → `btn-pri`, `accent`/`danger` → modifier on the appropriate canonical, `ghost` → `btn-ghost`; doc-comment refreshed
- Modify (consumer renames): `services/landing/app/actions/home/client/start-session-button.tsx` (drop `wf-btn-go`, use `.btn-pri`), `services/landing/app/actions/sessions/client/cancel-button.tsx` (`wf-btn wf-btn-ghost` → `.btn-ghost`), `services/landing/app/actions/sessions/client/copy-button.tsx` (`wf-chip` → `.btn-ghost`), `services/landing/app/actions/sessions/client/stop-button.tsx` (two button references), `services/landing/app/actions/sessions/page.tsx` (`wf-btn wf-btn-pri` → `.btn-pri`), `services/landing/app/actions/sessions/components/done.tsx` / `failed.tsx` / `kill-confirm.tsx` (similar), `services/landing/app/actions/sessions/components/ready.tsx` (`.wf-btn-action wf-btn-action-pri` → `.btn-pri`; `.wf-btn-action wf-btn-action-sec` → `.btn-sec`), and any `wf-tool` consumers in the composer footer
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — update selector lists; replace assertions for the retired classes with assertions for the new canonical names

**Approach:**
- Strip every old class name in the same commit as the CSS rename — no aliasing
- `.tool-key` (the inline mono `auto` / `postgres` value next to a tool button label) lives inside `.btn-ghost` as a descendant selector
- `.btn-sec.danger` reuses the canonical secondary geometry with red text and a red-toned border; preserves the kill-dialog look without inventing a new shape
- Copy-button reroute: a `.btn-ghost` is visually a tighter, transparent button; verify the click target is still tap-friendly in the live ready page
- Update `focus-ring.css` selector list in the same commit so keyboard focus continues to work

**Patterns to follow:**
- Canonical recipes: `OpenVoid Blocks.html` lines 127–141 (`.btn-pri`, `.btn-sec`, `.btn-ghost`)
- Existing `BLOCK_FILES` array drives the cascade order — drop `chip` and `tool`, leave the rest

**Test scenarios:**
- Happy path: every JSX `class="..."` previously containing `wf-btn*`, `wf-chip`, or `wf-tool` now contains the canonical equivalent; no stale class names remain in app/ (grep verifies zero matches)
- Edge case: disabled buttons keep their 45% opacity + `not-allowed` cursor (canonical `.btn-pri[disabled]` rule)
- Edge case: `.btn-sec.danger` renders red-toned border on the kill-confirm dialog button
- Integration: `:focus-visible` halo draws on each canonical button via `focus-ring.css` (manual keyboard-focus check on each variant)
- Test sweep: `blocks.test.ts` selector-list assertions updated; no test asserts for retired class names (`wf-btn`, `wf-btn-action`, `wf-btn-go`, `wf-chip`, `wf-tool`)

**Verification:**
- `grep -r "wf-btn\|wf-chip\|wf-tool" services/landing/app` returns zero matches in `.tsx` / `.ts` files
- `npm test` passes; `npm run typecheck` clean
- Live spot-check: primary CTA on the Create page, secondary buttons on Ready, ghost cancel on stop dialog, retired-chip-now-ghost copy button on Ready

---

### U3. Rename `.wf-input` → `.field`

**Goal:** Complete the canonical rename of the input block (the recipe was already aligned in this session's prior input refactor).

**Requirements:** R1, R4, R5, R7

**Dependencies:** U1

**Files:**
- Rename: `services/landing/public/styles/blocks/input.css` → `services/landing/public/styles/blocks/field.css`
- Modify: `services/landing/public/styles/blocks/field.css` — replace every `.wf-input` selector with `.field`; `textarea.wf-input` becomes `textarea.field`
- Modify: `services/landing/app/ui/document.tsx` — `BLOCK_FILES` entry `'input'` → `'field'`
- Modify: `services/landing/app/ui/input.tsx` — three `class="wf-input"` strings → `class="field"`; doc-comment refreshed
- Modify: `services/landing/app/ui/textarea.tsx` — `class="wf-input"` → `class="field"`; doc-comment refreshed
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — selector list update if `.wf-input` is asserted

**Approach:**
- Pure rename — no recipe changes (already aligned)
- Verify the composer textarea inside `compositions/composer.css` (which references `textarea.wf-input` indirectly via the `:focus-within` interaction) still works after the rename; update any cross-file references

**Patterns to follow:**
- Canonical recipe: `OpenVoid Blocks.html` lines 175–183 (`.inp-field` reference, which collapses to `.field` in the spec body)

**Test scenarios:**
- Happy path: rendered `<Input>` and `<Textarea>` carry `class="field"`; visual rendering unchanged
- Integration: composer textarea focus → composer halo draws on outer surface (composition layer overrides preserved)
- Edge case: keyboard focus on a standalone `<Input>` draws the inset accent stroke + 4px halo (already in place via `:focus`, not `:focus-visible`)

**Verification:**
- `grep -r "wf-input" services/landing/app` returns zero matches
- `npm test` passes

---

### U4. Rename `.wf-keycap` → `.kbd`

**Goal:** Adopt the canonical Keyboard Badge selector and add the `.dark` variant for use inside ink-background buttons (per canonical line 119).

**Requirements:** R1, R4

**Dependencies:** U1

**Files:**
- Rename: `services/landing/public/styles/blocks/keycap.css` → `services/landing/public/styles/blocks/kbd.css`
- Modify: `services/landing/public/styles/blocks/kbd.css` — `.wf-keycap` → `.kbd`; add `.kbd.dark` variant per canonical
- Modify: `services/landing/app/ui/document.tsx` — `BLOCK_FILES` entry `'keycap'` → `'kbd'`
- Modify: `services/landing/app/ui/client/shortcut-hint.tsx` — `wf-keycap` → `kbd`
- Modify: any other consumers that grep surfaces (run `grep -rn "wf-keycap" services/landing/app`)
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — selector list update

**Approach:**
- Recipe is already canonical (this session's prior keycap pass); pure rename + add `.dark` variant
- The `.dark` variant lets the canonical primary button carry a kbd hint on a dark background — useful in the composer's start-session button if/when we adopt it

**Patterns to follow:**
- Canonical recipe: `OpenVoid Blocks.html` lines 117–119

**Test scenarios:**
- Happy path: `<ShortcutHint>` rendering shows `<kbd class="kbd">⌘</kbd>` shape; no stale `wf-keycap` matches
- Integration: `.kbd.dark` renders correctly when nested inside an ink-background container (manual check)

**Verification:**
- `grep -r "wf-keycap" services/landing/app` returns zero matches
- `npm test` passes

---

### U5. Rename `.wf-pill-*` → `.pill` (Status Pill block)

**Goal:** Map the in-header status pills to canonical `.pill / .pill.live / .pill.prod`. Replace the nested `.wf-pill-dot` with the canonical nested `.d` (with `.d.pulse` for the breathing variant).

**Requirements:** R1, R4

**Dependencies:** U1

**Files:**
- Modify: `services/landing/public/styles/blocks/pill.css` — replace `.wf-pill-live` and `.wf-pill-ready` with the canonical `.pill / .pill.live / .pill.prod` recipe (lines 110–115); the breathing dot becomes `.pill .d.pulse`
- Modify: `services/landing/app/ui/document.tsx` — no entry rename needed (still `pill`)
- Modify: `services/landing/app/actions/sessions/page.tsx` — `wf-pill-live` → `pill live`; `wf-pill-dot wf-pill-dot-breathe` → `d pulse`
- Modify: `services/landing/app/actions/sessions/components/ready.tsx` — `wf-pill-ready` → `pill live` (or appropriate variant); `wf-pill-dot` → `d`
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — replace assertions for `.wf-pill-live`, `.wf-pill-ready`, `.wf-pill-dot`, `.wf-pill-dot-breathe` with `.pill`, `.pill.live`, `.pill .d`, `.pill .d.pulse`
- Verify: `breathe` keyframe — currently in `blocks/pill.css`, stays there (canonical references it via `.eyebrow .dot.live` and `.pill .d.pulse`)

**Approach:**
- Two paint variants, both inline color-soft + color foreground (live = accent-soft + accent; prod = ok-soft + ok)
- The "ready" pill is semantically a live pill (active session), so `wf-pill-ready` consumers map to `.pill.live` rather than its own variant
- Preserve the `breathe` keyframe — both Eyebrow Pill (U6) and Status Pill use it

**Patterns to follow:**
- Canonical recipe: `OpenVoid Blocks.html` lines 110–115 (`.sp` in the demo CSS = `.pill` in the spec)

**Test scenarios:**
- Happy path: rendered status pill in session header carries `class="pill live"`; breathing dot animates
- Edge case: a future `.prod` consumer would render with ok-soft paint (no current consumer; canonical recipe ready)
- Integration: `breathe` keyframe shared between Pill (U5) and Eyebrow (U6) — verify the animation still runs on both after U6

**Verification:**
- `grep -r "wf-pill" services/landing/app` returns zero matches
- `npm test` passes

---

### U6. Replace typography `.wf-eyebrow` with canonical pill `.eyebrow` (structural shift)

**Goal:** Adopt the canonical Eyebrow Pill block — a 24px pill with optional leading `.dot.live` — replacing the current typography-style `.wf-eyebrow` (uppercase mono ink-3 label). This is the largest call-site fan-out in the plan because `<Eyebrow>` is consumed from many session-state pages.

**Requirements:** R1, R4

**Dependencies:** U1, U5 (shares `breathe` keyframe with Pill block)

**Files:**
- Create: `services/landing/public/styles/blocks/eyebrow.css` — canonical `.eyebrow` recipe per `OpenVoid Blocks.html` lines 102–107; `.eyebrow.ok` paint variant; nested `.dot` and `.dot.live` (animated)
- Modify: `services/landing/public/styles/blocks/typography.css` — remove `.wf-eyebrow`; the bare `.eyebrow` selector is reserved for the canonical pill
- Modify: `services/landing/app/ui/document.tsx` — add `'eyebrow'` to `BLOCK_FILES`
- Modify: `services/landing/app/ui/eyebrow.tsx` — restructure JSX from `<span class="wf-eyebrow">` to `<span class="eyebrow"><span class="dot"></span>{children}</span>`; tone prop maps to `.eyebrow.ok` for `tone="ok"`, inline `mix` color override remains for `tone="danger"` until a canonical danger variant is decided (see Open Questions / Deferred to Implementation)
- Modify (direct `wf-eyebrow` consumers — many): `services/landing/app/actions/home/page.tsx`, `services/landing/app/actions/home/done-banner.tsx`, `services/landing/app/actions/sessions/page.tsx` (one direct + via `<Eyebrow>`), `services/landing/app/actions/sessions/components/ready.tsx` (two direct), `services/landing/app/actions/sessions/client/tip-carousel.tsx`, `services/landing/app/actions/sessions/client/stop-button.tsx`. Each direct `<span class="wf-eyebrow">` must decide: switch to `<Eyebrow>` JSX component (preferred, since the structural change is centralized there) or switch to `<span class="eyebrow">` raw
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — update selector assertions; new file `eyebrow.css` joins the test sweep

**Approach:**
- The structural shift means `<Eyebrow>` consumers visually change from a flat uppercase label to a pilled eyebrow with leading dot — verify each call site looks right against the canonical doc's preview
- Direct `wf-eyebrow` users that pass color overrides (e.g., `mix={css({ color: 'var(--wf-danger)' })}`) become a real design question: whether the Eyebrow Pill should grow a `.danger` paint variant. Defer the call to U6 implementation; the safest path is to keep `mix` overrides for danger and let the design author add the variant later
- The dot is optional — render `<span class="dot"></span>` only when the eyebrow represents a state (live, in-progress, ok); for plain section labels, omit it. `<Eyebrow>` props decide

**Patterns to follow:**
- Canonical recipe: `OpenVoid Blocks.html` lines 102–107 (`.ep` in the demo CSS = `.eyebrow` in the spec)
- The `breathe` keyframe lives in `blocks/pill.css` (post-U5); reference it from the new `eyebrow.css` without duplication

**Test scenarios:**
- Happy path: `<Eyebrow>Spinning up</Eyebrow>` renders as an accent pill with optional dot; `<Eyebrow tone="ok">Saved</Eyebrow>` renders ok-soft
- Edge case: `<Eyebrow tone="danger">` keeps inline color override for now (no `.eyebrow.danger` shipped); document this in the component comment
- Integration: dot animation (`.dot.live`) only fires on session-live contexts (Spinning up, Live), not on neutral labels (per canonical's "breathing dot only on live states" rule)
- Test sweep: `blocks.test.ts` no longer asserts on `.wf-eyebrow`; asserts on `.eyebrow` and `.eyebrow.ok`

**Verification:**
- `grep -r "wf-eyebrow" services/landing/app services/landing/public/styles` returns zero matches
- Live visual check on every session-state page: provisioning, ready, done, failed, stopping, kill-confirm, not-found
- `npm test` passes

---

### U7. Rename `.wf-alt` → `.alt` and align to canonical Alt Pill recipe

**Goal:** Adopt canonical `.alt / .alt.on` per `OpenVoid Blocks.html` lines 143–147. The canonical adds an active `.on` state with ink fill + paper text + shadow-2 + trailing `.x` dismiss glyph.

**Requirements:** R1, R4, R7

**Dependencies:** U1

**Files:**
- Modify: `services/landing/public/styles/blocks/alt.css` — `.wf-alt` → `.alt`; preserve current 32h / paper-2 default; add `.alt.on` paint variant (ink fill, paper text, shadow-2); preserve `[data-coming-soon]` opacity gate (no canonical equivalent — keep as a pragmatic addition)
- Modify: `services/landing/public/styles/blocks/focus-ring.css` — `.wf-alt:focus-visible` → `.alt:focus-visible`
- Modify: any JSX consumers (run `grep -rn "wf-alt" services/landing/app` — currently used in the composer's alt-row)
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — selector update

**Approach:**
- The `.on` state isn't currently used (the four alts in the composer are all "coming soon"); add the recipe per canonical so future activation paths exist
- Preserve `[data-coming-soon]` — it's a working solution to a real product constraint (alt pills must hover but be functionally inert pre-launch) and the canonical doc doesn't address pre-launch states

**Patterns to follow:**
- Canonical recipe: `OpenVoid Blocks.html` lines 143–147

**Test scenarios:**
- Happy path: alt pills in composer carry `class="alt"`; default paint matches canonical
- Edge case: `[data-coming-soon]` still gates cursor + opacity (regression guard against the canonical recipe accidentally overwriting)
- Integration: `:focus-visible` halo on `.alt` works (manual keyboard-tab through composer alt row)

**Verification:**
- `grep -r "wf-alt" services/landing/app` returns zero matches
- `npm test` passes

---

### U8. Final cleanup: focus-ring composite, dot.css decision, blocks.test consolidation, learning capture

**Goal:** Sweep the loose ends — verify `focus-ring.css` references only live selectors, decide whether `dot.css` survives, consolidate `blocks.test.ts` selector lists, and capture the refactor as a learning.

**Requirements:** R3, R5, R7

**Dependencies:** U1–U7

**Files:**
- Modify: `services/landing/public/styles/blocks/focus-ring.css` — final pass; verify every selector exists in a current `blocks/` file; remove any stragglers
- Audit: `services/landing/app/ui/status-dot.tsx` — assess whether `<StatusDot>` consumers can reroute to a canonical pill (likely not — `<StatusDot>` is used as a standalone leaf indicator, e.g., in the top bar's status indicator). If retained, `dot.css` keeps `wf-` prefix as a non-canonical utility; if retired, delete `dot.css` and the JSX component
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — final selector-list audit; group assertions by canonical block; ensure no stale `wf-*` assertions remain for renamed blocks
- Modify: `services/landing/README.md` — final tree refresh
- Optional: capture a learning at `docs/solutions/design-patterns/landing-blocks-canonical-alignment-2026-05-11.md` via `/ce-compound` — what worked, gotchas (the eyebrow structural shift, the chip retirement, the cascade insert)

**Approach:**
- This is the cleanup unit — no new design decisions, only reconciliation
- The dot decision: if `<StatusDot>` callers all sit inside contexts that have a canonical pill nearby, prefer rerouting and retiring; if even one caller is a standalone indicator with no pill peer, keep `dot.css` with `wf-` prefix and document why
- Capture a successor learning so future contributors have a roadmap for similar refactors

**Patterns to follow:**
- Existing learning shape: `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md`

**Test scenarios:**
- Happy path: `npm test` passes 192/192 (or new total if tests were added)
- Audit: `grep -rE "(\.wf-btn|\.wf-chip|\.wf-tool|\.wf-input|\.wf-keycap|\.wf-pill|\.wf-eyebrow|\.wf-alt)\b" services/landing` returns zero matches across CSS, JSX, and tests
- Test expectation: blocks.test.ts contains no assertion for a class that doesn't exist in the current file tree (no false positives, no stale guards)

**Verification:**
- All canonical-aligned classes carry bare selectors; no `wf-*` remains for renamed blocks
- `services/landing/public/styles/blocks/` contains only canonical-aligned blocks + non-canonical utilities (with documented justification)
- `services/landing/public/styles/compositions/` retains its 13 files with `wf-*` prefixes pending the next PR
- Learning doc exists or has a deliberate decision not to file one

---

## System-Wide Impact

- **Interaction graph:** `<Eyebrow>`, `<Button>`, `<Input>`, `<Textarea>`, `<StatusDot>`, `<ShortcutHint>` JSX components all change shape or class output; every call site needs to be updated in the same unit as the corresponding CSS rename
- **Cascade order:** loading `compositions/*.css` after `blocks/*.css` is a real new layer in the cascade; future block edits that try to override a composition will need `!important` or a JSX `mix` instead — call this out in the README
- **State lifecycle risks:** none — refactor is purely cosmetic / structural
- **API surface parity:** no public-facing API change (no exported types, no contracts touched); CSS class names are the only "API" affected
- **Integration coverage:** existing tests cover rendered HTML structure (`renderToString` assertions) — class-name renames break those; each unit updates the impacted assertions in the same commit
- **Unchanged invariants:** `tokens.css`, `composition.css`, `global.css` are not touched; visual output for unchanged surfaces is preserved; the 192-test suite remains green throughout

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `<Eyebrow>` structural shift (typography label → pill) creates unintended visual regressions on session-state pages | U6 includes a manual visual check on every session-state page; capture before/after screenshots in the PR description |
| `wf-card-elev > .stack` cross-layer coupling breaks when surface.css moves to compositions/ | U1 includes a Ready-page bottom-row alignment smoke check; the descendant combinator stays intact (move is verbatim) |
| `wf-chip` retirement reroutes copy-button to `.btn-ghost` — different shape (smaller, transparent) may affect tap target | U2 includes a tap-target check on the live Ready page; if too small, restyle copy-button with explicit padding |
| `breathe` keyframe is referenced from both pill.css (U5) and eyebrow.css (U6); split-loading order matters for the cascade | Keep `breathe` definition in pill.css (loaded first by alphabetical order); eyebrow.css references but does not redefine |
| Cascade insert of `compositions/` between blocks and exceptions changes specificity for any composition that targets a block via descendant — could surface latent issues | U1 explicitly verifies every existing visual still matches; if a regression surfaces, debug per-case (likely a missing override in compositions) |
| `.eyebrow.danger` design decision deferred to U6 implementation; risks an inconsistent paint approach across consumers | U6 picks a single answer (canonical variant vs `mix` override) and applies it everywhere; document in the PR description |
| Compositions folder name (`compositions/`) overlaps with CUBE composition layer (`composition.css`) — terminology confusion for future contributors | Add a one-line comment at the top of the first composition file (`compositions/composer.css`) explaining the distinction; consider a follow-up rename of `composition.css` → `layout-primitives.css` (deferred) |

---

## Documentation / Operational Notes

- Update `services/landing/README.md` styles tree in U1 (preliminary) and U8 (final)
- After merge, file a `/ce-compound` learning at `docs/solutions/design-patterns/` capturing the canonical-alignment workflow (file moves, rename discipline, JSX consumer fan-out) — useful for the next PR (compositions alignment) which will follow the same shape
- The next PR depends on the user dropping a `docs/designs/OpenVoid Compositions.html` analogous to the Blocks doc; this plan creates the empty canvas (the `compositions/` folder) for that PR to operate on
- No rollout, monitoring, or migration concerns — pure SSR-rendered CSS refactor

---

## Sources & References

- **Canonical design doc:** `docs/designs/OpenVoid Blocks.html` — source of truth for every rename and recipe decision
- **Canonical tokens:** `docs/designs/OpenVoid Tokens.html` — paint, focus-ring, and primitives consumed by the renamed blocks
- **Prior session work:** input refactor (this session) already aligned `.wf-input` recipe to canonical `.field`; U3 is just the rename
- **Related learnings:**
  - `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` — codebase uses `class="..."`; grep targets confirmed
  - `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md` — references `.wf-card-elev` and `.wf-btn-action-pri` examples that go stale after this refactor; capture a successor in U8
- **External:** Andy Bell's CUBE CSS methodology (`https://cube.fyi/`) — informs the layer-ordering decision (compositions after blocks)
