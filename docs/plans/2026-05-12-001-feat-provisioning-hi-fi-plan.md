---
title: Implement Provisioning Hi-Fi redesign
type: feat
status: active
date: 2026-05-12
---

# Implement Provisioning Hi-Fi redesign

## Summary

Rewrite the Provisioning view to the Hi-Fi shape from `docs/designs/Provisioning Hi-Fi.html`: eyebrow pill with breathing dot, session-id hero, lede copy, progress card (title + ETA + animated bar + 5-step list), collapsible synthetic live log, and Cancel link moved to the page header. A single client-side storyboard timer (~25s total, semi-random per-step) drives the step list, ETA countdown, and log progression in lockstep — no backend changes required. Also scaffolds the canonical `.eyebrow` Pill block and `.stage` composition (first consumers for both).

---

## Problem Frame

The current Provisioning view (`services/landing/app/actions/sessions/components/provisioning.tsx`) is a center-aligned spinner-and-session-id layout with the TipCarousel for time-fill. The new Hi-Fi design replaces the spinner with a structured progress card that telegraphs what's happening (5 named boot steps, animated progress bar, ETA countdown, optional live log) and elevates the app-name hero. Visually richer, informationally denser, more confidence-inspiring. No backend signals exist yet for per-step progress, ETA, or logs — the Hi-Fi's storyboard runs client-side as a synthetic v1.

---

## Requirements

- R1. Provisioning view matches the Hi-Fi shape: header chrome with right-side Cancel, page-centered stage with eyebrow pill, name-row hero, lede copy, progress card, and footer "View full logs / restart provisioning" disclosure link
- R2. Eyebrow pill uses canonical `.eyebrow` block per `OpenVoid Blocks.html` entry 06 — accent-soft paint, breathing-dot `.dot.live`, no `wf-` prefix
- R3. Page-centering wrapper uses canonical `.stage` composition per `OpenVoid Compositions.html` entry 02 — full-viewport-height column, gap 20px, paper bg
- R4. 5-step list ("Allocating sandbox", "Cloning starter template", "Installing dependencies", "Booting agent", "Mounting preview server") progresses through done → active → pending states on a client-side storyboard timer of ~25s total, with semi-random per-step timing
- R5. ETA reads "Ns remaining" and counts down from the same ~25s storyboard timer
- R6. Progress bar fills linearly from 0% to ~95% across the storyboard's elapsed window (`barPct = elapsed / 25 * 95`). The Hi-Fi's `46 + (12 - secs) * 4` curve was demo-specific (12s timeline opening at 46%); the 25s storyboard uses a true linear ramp from 0% instead — different curve shape, owned as a deliberate plan-time decision rather than a port.
- R7. Live-log disclosure (collapsed by default) reveals a synthetic terminal-style log with ~7 log lines whose final "installing" line shows a blinking cursor while the storyboard is mid-flight
- R8. When the storyboard timer expires and `pendingPhase` is still pending, the step list plateaus on the last "active" step (no rewind, no synthetic completion) — when the backend transitions to Running, the existing StatusPoller swaps the view
- R9. Cancel action moves from the in-body `<CancelButton>` to the page header (`topBarRight` slot) as a `.btn-ghost` (per the design's `.ghost-link` shape — canonical `.btn-ghost` is the closest match)
- R10. `<TipCarousel>` is dropped from Provisioning (design omits it); the component file is retained for potential future use
- R11. Tests pass; no regression on the StatusPoller's pending→Running transition or the Ready view rendering

---

## Scope Boundaries

- No Session API additions (no step events, no ETA endpoint, no log streaming) — every signal in the new view is client-side synthetic
- No persistence of derived slug or app name to the Session model — hero shows session-id verbatim
- No real log streaming
- No changes to `tokens.css`, `global.css`, `layout-primitives/`, or other canonical layers except scaffolding `.stage` and `.eyebrow`
- No reuse of the storyboard pattern for other pages (Stopping, Failed, etc.)
- No retirement of the `<TipCarousel>` component file (kept for potential future use)

### Deferred to Follow-Up Work

- Real per-step backend signal (would let the storyboard track actual progress instead of a fake timer)
- Real ETA from backend (the Kubernetes provisioning controller could publish a remaining-time estimate)
- Real log streaming (would replace the synthetic placeholder)
- App-name plumbing (would let the hero show `recipe-jar`-style names instead of session-id)
- Generalizing the storyboard clientEntry for reuse on other state-transition pages

---

## Context & Research

### Relevant Code and Patterns

- `services/landing/app/actions/sessions/components/provisioning.tsx` — current view, to be rewritten
- `services/landing/app/actions/sessions/page.tsx` — passes `pendingPhase` and currently renders `<Provisioning>` in the page body; needs a `topBarRight` swap when view is Provisioning
- `services/landing/app/actions/sessions/client/cancel-button.tsx` — current Cancel implementation, moves to header
- `services/landing/app/actions/sessions/client/tip-carousel.tsx` — kept on disk but no longer imported by Provisioning
- `services/landing/app/actions/sessions/client/status-poller.tsx` — unchanged; continues to drive the pending→Running transition
- `services/landing/app/actions/sessions/client/copy-button.tsx`, `cancel-button.tsx`, `open-link-shortcuts.tsx` — reference clientEntry patterns to mirror for the new `ProvisioningStoryboard` clientEntry (queueTask deferral, handle.signal cleanup)
- `services/landing/public/styles/blocks/pill.css` — already houses the canonical `.pill` block and the `breathe` keyframe (the `.eyebrow .dot.live::after` rule will reference the same keyframe)
- `services/landing/public/styles/compositions/app-shell.css` — pattern for new `.stage` composition rule
- `services/landing/public/styles/blocks/spinner.css`, `app-icon.css` — both have only Provisioning as a consumer; can be retired once the rewrite lands

### Institutional Learnings

- `docs/solutions/design-patterns/remix-3-layout-primitive-composition-2026-05-10.md` — `.stage` composition fits the spatial-composition pattern documented here
- `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` — codebase uses `class="..."` consistently; the new components follow that convention

### External References

- `docs/designs/Provisioning Hi-Fi.html` — source of truth for the visual shape and storyboard timing curve
- `docs/designs/OpenVoid Blocks.html` entry 06 — canonical Eyebrow Pill recipe
- `docs/designs/OpenVoid Compositions.html` entry 02 — canonical Stage composition recipe

---

## Key Technical Decisions

- **Single storyboard timer drives steps + ETA + log**: One `ProvisioningStoryboard` clientEntry owns a per-step duration array (semi-random, summing to ~25s) and a single `setInterval` that advances `currentStep`, `etaSeconds`, and `currentLogLine` together via `handle.update()`. Three views from one source of truth; no drift between them.
- **Elapsed is anchored to a stable timestamp, not mount time**: The storyboard's `elapsedSec` is computed each tick as `max(0, (Date.now() - parseISO(sessionCreatedAt)) / 1000)`. The `sessionCreatedAt` ISO timestamp is threaded through Provisioning props from the controller's view derivation (Session record's `createdAt`). This survives clientEntry re-mounts on `pending → running-pre-ingress` transitions (StatusPoller's `navigate({ history: 'replace' })` re-renders Provisioning, which would otherwise restart elapsed at 0 and visibly rewind the bar/steps/ETA mid-progress). It also survives tab-backgrounding correctly: when a backgrounded tab resumes, the wall-clock anchor self-syncs to the real elapsed time rather than catching up via accumulator ticks. Honors R8's plateau guarantee on the happy path.
- **Semi-random per-step timing**: Generated once at mount with a seeded-from-`sessionId` shuffle so the same session ID produces the same timing on retry (no jitter between SSR and hydration if the client picks a different random seed). The five durations sum to ~25s with each step in a reasonable range (e.g., 2–7s).
- **Plateau, don't rewind**: When the timer hits its last step, the storyboard freezes on "Mounting preview server" as active. No synthetic completion. The StatusPoller continues polling and swaps the view to Ready when the backend transitions.
- **Degraded long-running state after elapsed > 30s** (5s grace past the 25s storyboard end): the steady-state visuals were designed for transient progress, not for 60s+ stuck states. After the grace window expires, the storyboard transitions to an honest long-running display:
  - ETA element hides entirely (the "0s remaining" pin would lie for 60+ seconds otherwise)
  - Progress bar swaps to an indeterminate animation (CSS-only striped shimmer with no fixed width — the existing 95% pin becomes a moving stripe)
  - The active step's meta-text changes from the blinking cursor to "taking longer than usual"
  - The log cursor still blinks, but only because the log is opt-in (the user opened it)
  All client-side; no backend signal needed. The storyboard self-reports honesty when backed by no telemetry.
- **Hero is session-id verbatim, capped at 24px**: Renders as `<h1 class="mono">` at 24px (not the Hi-Fi's 38px — that size was designed for 9-char friendly names like `recipe-jar`, and a 26-char ULID at 38px on a 560px card produces visually fragmented text). Uses `word-break: keep-all` and `overflow-wrap: anywhere` so the ULID stays on one line on wide viewports and breaks only at the box edge on narrow ones. On viewports ≤560px, font-size reduces further to 18px per the Hi-Fi's breakpoint pattern. No derived-slug plumbing in this PR.
- **Live log is collapsed by default**: The `<button class="disc">` toggles open. Synthetic log lines reference the same step events as the step list, with the final "installing" line carrying a blinking-cursor indicator while the storyboard is mid-flight.
- **Cancel moves to header via Layout's existing `topBarRight` slot**: The `sessions/page.tsx` view dispatch passes `<CancelButton sessionId={...} />` to `topBarRight` when view is Provisioning; the CancelButton's render output stays as a `.btn-ghost` button but lives in the header chrome.
- **`.eyebrow` canonical recipe over the Hi-Fi's slightly-larger dimensions**: The Hi-Fi uses 26h / gap 8 / font-size 11.5; the canonical Blocks doc spec'd 24h / gap 7 / font-size 11. Adopt the canonical numbers as authoritative — design drift between Hi-Fi and Blocks doc should be resolved by updating the canonical doc, not by case-by-case Hi-Fi-fidelity overrides.
- **Retire `wf-spinner` and `wf-app-icon`**: Provisioning is the only consumer of both; the redesign removes the hero spinner entirely. Delete the CSS files and drop from `BLOCK_FILES`.
- **Synthetic-signal UI is a deliberate bet, not a hidden cost**: The step list, ETA, progress bar, and live log are all client-side fabrications. The bet is that the visual richness improves perceived quality more than the developer-audience credibility cost subtracts from it when an observant user notices the fabrication (e.g., DevTools shows `setInterval` driving "progress"; the same sessionId reproduces the same per-step timing on retry; log lines appear on a wall-clock schedule rather than as backend output). Mitigations applied to the bet: fabricated telemetry-shaped step metas (`us-east-1 · 1.2s`) dropped; long-running degraded state (after 30s elapsed) swaps to honest indeterminate visuals so the unhappy path doesn't lie. Revisit when real backend signals (per-step events, real ETA, real log stream) arrive — at that point the storyboard becomes a thin presentation layer over real data instead of a fiction.

---

## Open Questions

### Resolved During Planning

- **App name source**: Random session ID (user confirmed).
- **Live log strategy**: Synthetic placeholder with step-progress lines summing to ~25s (user confirmed).
- **Step list strategy**: Hardcoded heuristic (user confirmed).
- **ETA strategy**: Fake client-side countdown (user confirmed).
- **Eyebrow dimensions**: Canonical (24h) over Hi-Fi (26h) — design drift surfaced to author in PR description.

### Deferred to Implementation

- **Exact per-step duration distribution**: Pick a reasonable range during implementation (e.g., 2–7s with the sum normalized to 25s). The exact mix doesn't affect correctness; visual smoke during impl confirms it feels right.
- **Whether `wf-spinner` / `wf-app-icon` CSS files get retired in this PR or in a follow-up cleanup**: Pragmatic call — retire if grep confirms zero consumers post-rewrite; defer if any test or doc still references them.
- **Mono utility for session-id hero**: Whether to use `class="mono"` (utility) or inline `font-family: var(--font-mono)` via `mix` — decide based on which renders cleaner with the 24px capped headline.

### Deferred to Follow-Up Work

- **`breathe` keyframe canonical alignment**: Three sources define `@keyframes breathe` with subtle differences — `pill.css` (production, 2 keyframes scale 2.6), `OpenVoid Blocks.html` (canonical, 3 keyframes scale 2.4 with 70% dwell stop), and `Provisioning Hi-Fi.html` eyebrow (3 keyframes scale 2.6). U1 inherits whatever `pill.css` has today; canonical alignment is a separate follow-up that updates `pill.css` to match the Blocks doc shape, which both `.pill .d.pulse` and `.eyebrow .dot.live` then consume identically.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Storyboard timer architecture** (single source of truth):

```text
ProvisioningStoryboard (clientEntry)
├── state: durations[5]       ← per-step durations summing to ~25s, seeded by sessionId
├── state: stepIndex          ← 0..4, current active step
├── state: elapsedSec         ← 0..25, total elapsed
├── state: etaSec              ← derived: 25 - elapsedSec, floor 0
└── tick (setInterval 250ms)
    ├── advance elapsedSec
    ├── recompute stepIndex from cumulative durations
    ├── update DOM:
    │   ├── #step-{i}.step → done | active | pending
    │   ├── #eta            → "Ns remaining"
    │   ├── #bar-fill       → width = elapsed/25 * 95  (linear ramp 0→95% over the 25s window; plateau holds at 95% past 25s, swaps to indeterminate stripes past 30s)
    │   └── #log-cursor     → blink visible while stepIndex < 5
    └── plateau when stepIndex >= 4 (last active)
```

**Component / DOM shape:**

```text
Layout (topBarRight={<CancelButton/>})
└── <main class="stage">
    ├── <span class="eyebrow"><span class="dot live"></span> Spinning up</span>
    ├── <div class="name-row">
    │   ├── <h1 class="mono">{sessionId}</h1>
    │   └── <p class="lede">Provisioning a fresh sandbox…</p>
    ├── <div class="card-shell" data-storyboard>     ← canonical Card Shell
    │   ├── <div class="card-head">
    │   │   ├── <span class="title">Boot sequence</span>
    │   │   └── <span class="eta"><span class="num" id="eta">25</span>s remaining</span>
    │   ├── <div class="bar"><div class="bar-fill" id="bar"/></div>
    │   ├── <ul class="steps">
    │   │   ├── <li id="step-0" class="step"><...>
    │   │   ├── <li id="step-1" class="step"><...>
    │   │   └── …5 total
    │   ├── <button class="disc">Show live log</button>
    │   └── <div class="log">
    │       ├── log lines (synthetic, ~6 lines)
    │       └── final line carries .blink cursor while in-flight
    │   ProvisioningStoryboard clientEntry (invisible, mounts here)
    └── <p class="foot">Trouble? <a>View full logs</a> or <a>restart provisioning</a></p>
```

The `data-storyboard` attribute on the card is the queryable anchor for the clientEntry to find its DOM. Inline `id="step-0"` through `id="step-4"` plus `id="eta"`, `id="bar"`, `id="log-cursor"` give the clientEntry stable selectors.

---

## Output Structure

```text
services/landing/
├── public/styles/
│   ├── blocks/
│   │   ├── eyebrow.css            # NEW — canonical Eyebrow Pill block
│   │   ├── app-icon.css           # DELETED — no consumers post-rewrite
│   │   └── spinner.css            # DELETED — no consumers post-rewrite
│   └── compositions/
│       ├── stage.css              # NEW — canonical Stage composition
│       └── provisioning-card.css  # NEW — the boot-sequence card (steps, bar, log)
└── app/
    └── actions/sessions/
        ├── components/provisioning.tsx  # rewritten
        └── client/
            └── provisioning-storyboard.tsx  # NEW clientEntry
```

The new CSS files split between `blocks/` (canonical leaf primitives) and `compositions/` (assemblies). `provisioning-card.css` holds the layout-specific rules for the Boot Sequence card (step states, bar shimmer, log terminal styling) — non-canonical product surface, kept under `wf-` prefix if any selectors collide with canonical names, otherwise bare.

---

## Implementation Units

### U1. Scaffold canonical `.eyebrow` Pill block

**Goal:** Create the canonical Eyebrow Pill block (`OpenVoid Blocks.html` entry 06) — 24h pill with accent-soft paint, optional nested `.dot` and animated `.dot.live`.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Create: `services/landing/public/styles/blocks/eyebrow.css`
- Modify: `services/landing/app/ui/document.tsx` — add `'eyebrow'` to `BLOCK_FILES` (alphabetical position)
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — add `.eyebrow`, `.eyebrow.ok`, `.eyebrow .dot.live` to the canonical selector list

**Approach:**
- Recipe per canonical: 24h, gap 7, padding 0/11, br --r-pill, accent-soft bg, accent fg, font 600 11px, letter-spacing 0.04em, uppercase
- `.eyebrow.ok` paint modifier (ok-soft + ok)
- Nested `.dot` (6px, currentColor) and `.dot.live::after` (breathing halo via `@keyframes breathe`, which already lives in `blocks/pill.css` — reference, don't redefine)
- **`prefers-reduced-motion` rule**: under `@media (prefers-reduced-motion: reduce)`, set `.eyebrow .dot.live::after { animation: none }`. The static accent-paint dot remains visible; only the breathing halo is suppressed.
- No JSX consumer in this unit — U4 wires the first consumer

**Patterns to follow:**
- `services/landing/public/styles/blocks/pill.css` — selector shape, breathe-keyframe reference pattern, nested `.d.pulse` for the Status Pill's analog of `.dot.live`

**Test scenarios:**
- Happy path: `blocks.test.ts` finds `.eyebrow`, `.eyebrow.ok`, and `.eyebrow .dot` selectors in the concatenated blocks CSS
- Edge case: the `breathe` keyframe is NOT re-declared in `eyebrow.css` (still owned by `pill.css`)
- Test expectation: visual smoke verified in U4 when the first consumer renders

**Verification:**
- `public/styles/blocks/eyebrow.css` exists with the canonical recipe
- `document.tsx`'s `BLOCK_FILES` includes `'eyebrow'`
- `npm test` passes 196+/196+

---

### U2. Scaffold canonical `.stage` composition

**Goal:** Create the canonical Stage composition (`OpenVoid Compositions.html` entry 02) — full-viewport-height flex column with consistent gap. Provisioning is the first consumer.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Create: `services/landing/public/styles/compositions/stage.css`
- Modify: `services/landing/app/ui/document.tsx` — add `'stage'` to `COMPOSITION_FILES` (alphabetical)
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — extend the `compositions/` directory-list assertion to include `stage.css`

**Approach:**
- Recipe per canonical: `min-height: calc(100vh - var(--h-header))`, flex column, items-center, justify-center, gap 20, padding 60/24
- Two variants per canonical doc: centered (justify-center) and top-aligned (padding-top + gap). v1 ships centered only — surface top-aligned as deferred until a consumer materializes.
- Max-width lives on children, not on the stage. Stage is always full-bleed.
- File header comment cites canonical entry 02 and notes the variant deferred

**Patterns to follow:**
- `services/landing/public/styles/compositions/app-shell.css` — file header comment shape, canonical-citation pattern
- `services/landing/public/styles/compositions/card-shell.css` — descendant-rule convention for any internal slot styling

**Test scenarios:**
- Happy path: `blocks.test.ts` finds `stage.css` in the compositions/ directory listing
- Test expectation: visual verification deferred to U4 (first consumer)

**Verification:**
- `public/styles/compositions/stage.css` exists with the canonical centered recipe
- `document.tsx`'s `COMPOSITION_FILES` includes `'stage'`
- `npm test` passes

---

### U3. ProvisioningStoryboard clientEntry — shared storyboard timer

**Goal:** Implement the client-side storyboard timer that drives the step list, ETA countdown, progress bar, and log cursor in lockstep. Runs ~25s total, semi-random per-step durations seeded by sessionId, plateaus on last step.

**Requirements:** R4, R5, R6, R7, R8

**Dependencies:** None (purely client-side; consumes the DOM emitted by U4)

**Files:**
- Create: `services/landing/app/actions/sessions/client/provisioning-storyboard.tsx`
- Create: `services/landing/test/actions/sessions/client/provisioning-storyboard.test.tsx`

**Approach:**
- `clientEntry<{ sessionId: string }>` per the codebase's existing clientEntry shape (cancel-button.tsx is the reference)
- Generate 5 per-step durations at mount: a seeded shuffle of a base distribution like `[3, 4, 5, 6, 7]` (summing to 25), seeded by `hash(sessionId)` so the same sessionId reproduces the same timing on re-render. **The shuffle is computed client-side only — durations are NEVER serialized into SSR-emitted HTML, props, data-attributes, or inline scripts.** This removes any SSR-vs-client determinism obligation; the implementer is free to pick any reasonable deterministic JS (e.g., FNV-1a hash + seeded Fisher-Yates) without worrying about matching what SSR would have produced.
- One `setInterval(250ms)` ticks; each tick recomputes `elapsedSec = max(0, (Date.now() - parseISO(props.sessionCreatedAt)) / 1000)` rather than accumulating — this is the stable-timestamp anchor that survives re-mounts and tab-backgrounding (see Key Technical Decisions)
- Each tick: compute current `stepIndex` from cumulative durations; update DOM IDs `#step-0` … `#step-4` with `done | active | pending` classes; update `#eta` textContent; update `#bar-fill` style.width; toggle `#log-cursor` blink class
- Plateau behavior: when `elapsedSec >= 25`, freeze on `stepIndex = 4` (active), continue updating ETA to `0s` and bar to `95%`
- Cleanup: `handle.signal.aborted` short-circuits the tick; `clearInterval` on signal abort
- SSR fallback: initial DOM emitted by U4 has step 0 active, ETA at 25s, bar at 0% (matches what the storyboard will render in its first tick — no jank on hydration)

**Execution note:** Implement test-first — the clientEntry's behavior is deterministic given a seeded sessionId, so unit testing the elapsed→stepIndex mapping is the cleanest starting point.

**Technical design:** *(directional)*

```text
durations = seededShuffle([3,4,5,6,7], hashSessionId(sessionId))
cumulative = [3, 7, 12, 18, 25]   ← prefix sums

tick(elapsed):
  stepIndex = (
    elapsed < 3  ? 0 :
    elapsed < 7  ? 1 :
    elapsed < 12 ? 2 :
    elapsed < 18 ? 3 :
    4
  )
  etaSec = max(0, 25 - elapsed)
  barPct = min(95, elapsed / 25 * 95)
  for i in 0..4:
    step_i.class = (i < stepIndex) ? 'done' : (i == stepIndex) ? 'active' : 'pending'
```

**Patterns to follow:**
- `services/landing/app/actions/sessions/client/cancel-button.tsx` — clientEntry skeleton, `handle.update()` pattern
- `services/landing/app/actions/sessions/client/status-poller.tsx` — `handle.signal`-aware cleanup, `queueTask`-deferred state writes
- `services/landing/app/actions/home/client/derived-slug.tsx` — DOM-query pattern (`document.querySelector` inside the entry)

**Test scenarios:**
- Happy path: given sessionId "01H..." and elapsed=0, stepIndex=0; elapsed=5, stepIndex=1; elapsed=20, stepIndex=4
- Edge case: elapsed > 25 → stepIndex stays at 4 (plateau, no overflow)
- Edge case: elapsed exactly at a step boundary (e.g., 3.0) — uses `<` semantics so step 0 just finished, step 1 is active
- Determinism: hashSessionId("01HABCDEF") returns the same shuffle order on two calls
- Integration: SSR-emitted DOM has correct initial state (step-0 active, eta 25, bar 0%) so hydration doesn't visually flash
- Cleanup: aborting `handle.signal` halts the interval (no further DOM mutations after abort)

**Verification:**
- The clientEntry mounts and updates `#step-i`, `#eta`, `#bar-fill` on a 250ms tick
- Plateau works (elapsed > 25s freezes on step 4 active)
- Same sessionId produces same step timing across re-mounts

---

### U4. Rewrite Provisioning component with new layout

**Goal:** Replace the current `provisioning.tsx` body with the Hi-Fi layout — eyebrow pill, name-row hero, lede, progress card (head + bar + steps + disclosure + log), footer. Wire the `ProvisioningStoryboard` clientEntry.

**Requirements:** R1, R7, R8, R10

**Dependencies:** U1, U2, U3, U5 — U5 ships header Cancel first; U4 then removes the body Cancel. Inverted from the natural reading-order so no commit on the branch ships a Cancel-less Provisioning view.

**Files:**
- Modify: `services/landing/app/actions/sessions/components/provisioning.tsx` — full rewrite
- Create: `services/landing/public/styles/compositions/provisioning-card.css` — boot-sequence card styling (steps, bar, log terminal — names and dimensions per Hi-Fi). Includes a `@media (prefers-reduced-motion: reduce)` block that suppresses three animations: the active-step check's `breathe` halo, the bar's `shimmer`, and the log's `blink` cursor. Bar fill width transition alone communicates progress; cursor renders as a static block character.
- Modify: `services/landing/app/ui/document.tsx` — add `'provisioning-card'` to `COMPOSITION_FILES`
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — extend compositions/ directory-list assertion
- Modify: `services/landing/test/actions/sessions.controller.test.ts` — update the "renders Provisioning for a Pending session" assertions to match the new DOM shape

**Approach:**
- Top-level wrapper: `<main class="stage">` (no per-page max-width — children own their widths)
- `<span class="eyebrow"><span class="dot live"/>Spinning up</span>`
- `<div class="name-row"><h1 class="mono">{sessionId}</h1><p class="lede">{statusCopy}</p></div>`
- `<div class="card-shell" data-storyboard>` containing card-head, bar, steps (5 `<li>` with `id="step-0"…4`), disclosure button, log
- The 5-step labels match the Hi-Fi text verbatim ("Allocating sandbox", "Cloning starter template", "Installing dependencies", "Booting agent", "Mounting preview server"). **The Hi-Fi's per-step meta column (e.g., "us-east-1 · 1.2s", "node-20 · 0.8s", "184 packages") is dropped from this PR** — those strings read as backend telemetry on a developer-tools audience but are fabricated, and a user noticing the same "1.2s" on every retry would lose trust in the rest of the page. Step state (done / active / pending) + the bar are sufficient progress signal.
- Disclosure markup is accessible: `<button class="disc" aria-expanded="false" aria-controls="provisioning-log">` with `id="provisioning-log"` on the log `<div>`. The toggle (clientEntry or inline script) flips `aria-expanded` to `"true"` alongside the `.open` class; flips back on collapse. Keyboard focus stays on the button after toggling (standard disclosure pattern — the log region is not focusable).
- Log content per Hi-Fi: 7 lines, terminal-styled
- SSR initial state matches what the storyboard's first tick will set (step-0 active, eta 25, bar 0%) — no flash on hydration
- `<ProvisioningStoryboard sessionId={sessionId} />` mounts invisibly inside the card
- `<TipCarousel>` import and usage removed
- `<CancelButton>` import removed from this file — moved to U5
- Status copy (`pendingPhase` branching) stays in the lede, not the card

**Patterns to follow:**
- `services/landing/app/actions/sessions/components/ready.tsx` — clientEntry mount pattern (`<X clientEntry />` interspersed in JSX)
- `services/landing/public/styles/compositions/composer.css` — file header comment shape for a composition with multiple sub-zones (the provisioning card has card-head, bar, steps, disclosure, log)

**Test scenarios:**
- Happy path: rendered Provisioning HTML contains `<main class="stage">`, `<span class="eyebrow">`, `<h1 class="mono">{sessionId}</h1>`, `<div class="card-shell" data-storyboard>`, 5 `<li class="step" id="step-N">` elements, and the disclosure `<button class="disc" aria-expanded="false" aria-controls="provisioning-log">`
- Happy path: log `<div>` has `id="provisioning-log"`; SSR ships with `aria-expanded="false"`; clientEntry toggles to `"true"` on click
- Happy path: lede copy changes between `pendingPhase='pending'` and `pendingPhase='running-pre-ingress'` (existing STATUS_COPY behavior preserved)
- Edge case: no TipCarousel in the DOM (regression guard against the import being re-added)
- Edge case: no Cancel button in the body (Cancel moves to header in U5; a Provisioning body that still emits CancelButton means the U5 work didn't land)
- Integration: SSR-emitted bar width = 0% and ETA = 25; hydration replaces these without visual jank (smoke-tested manually)

**Verification:**
- The view renders the Hi-Fi DOM shape and the storyboard advances on real browser load
- `npm test` passes; the Provisioning controller test asserts on the new DOM
- Visual smoke: the page looks like the Hi-Fi at first paint, mid-progress, and at 25s+ plateau

---

### U5. Move Cancel link to header via `topBarRight`

**Goal:** When the view is Provisioning, the Layout's `topBarRight` slot carries the `<CancelButton>`. The button stays a `.btn-ghost` per existing `cancel-button.tsx` recipe; only its DOM location changes.

**Requirements:** R9

**Dependencies:** None — U5 lands FIRST (before U4's body rewrite) so every commit on the branch has a working Cancel affordance. During the brief intermediate state where both header (new) and body (old) Cancel render, the duplicate is acceptable — the design ships with header-only after U4 lands.

**Files:**
- Modify: `services/landing/app/actions/sessions/page.tsx` — when `view.kind === 'provisioning'`, pass `topBarRight={<CancelButton sessionId={view.sessionId} />}` to `<Layout>`
- Modify: `services/landing/test/actions/sessions.controller.test.ts` — assert the Cancel button appears in the header chrome (inside the `<header>` element, before the body `<main>`) for Provisioning

**Approach:**
- The page.tsx already has a `headerRight` variable that the Ready view uses for the LivePill + Avatar combo; extend the same conditional for Provisioning to compose both Cancel and Avatar: the topBarRight content for Provisioning is `<><CancelButton sessionId={view.sessionId} /> <Avatar /></>` (matching the Hi-Fi's header which renders both side-by-side). Reuse Ready's `HeaderSlot` gap pattern, or specify an inline `gap: var(--sp-3)` wrapper.
- No JSX changes to `cancel-button.tsx` itself — the same `.btn-ghost` button just gets positioned by the header chrome
- Avatar continues to render on every view; Provisioning gains the Cancel sibling, doesn't lose the Avatar
- No change to the cancel form action — still `POST /sessions/:id` with `intent=cancel`

**Patterns to follow:**
- `services/landing/app/actions/sessions/page.tsx` — existing `headerRight` ternary for Ready vs other views

**Test scenarios:**
- Happy path: Provisioning view renders the Cancel button inside `<header>` (regex match on header containing `class="btn-ghost"` + "Cancel" text)
- Happy path: Provisioning header ALSO renders the Avatar adjacent to Cancel (regex match on header containing both)
- Happy path: Ready view's headerRight (LivePill + Avatar) is unaffected
- Edge case: Done / Failed / Stopping / Kill-confirm views do NOT emit a Cancel button in the header (no false-positive header CTAs)

**Verification:**
- The Cancel button renders in the top-right of the page chrome on Provisioning
- The cancel form still POSTs `intent=cancel` and the controller's existing cancel path triggers
- `npm test` passes

---

### U6. Final cleanup — retire `wf-spinner` / `wf-app-icon`, refresh README + doc comments

**Goal:** With the rewrite landed, the spinner and app-icon CSS files have zero consumers. Delete them, drop from BLOCK_FILES, and refresh the README styles tree. Audit for any other stale references.

**Requirements:** R11

**Dependencies:** U1, U2, U3, U4, U5

**Files:**
- Delete: `services/landing/public/styles/blocks/spinner.css`
- Delete: `services/landing/public/styles/blocks/app-icon.css`
- Modify: `services/landing/app/ui/document.tsx` — drop `'spinner'` and `'app-icon'` from `BLOCK_FILES`
- Modify: `services/landing/test/ui/styles/blocks.test.ts` — remove the directory-list assertions for these two files
- Modify: `services/landing/README.md` — refresh the styles tree (add `eyebrow.css`, `stage.css`, `provisioning-card.css`; remove `spinner.css`, `app-icon.css`)

**Approach:**
- Confirm via grep that no JSX or test references `wf-spinner` or `wf-app-icon` (the U4 rewrite removed the last consumer)
- Update the README's "leaf display primitives" line to drop the spinner/app-icon mentions; add the new canonical eyebrow/stage entries
- No doc-comment audit needed in other .tsx files — neither selector had cross-file doc references

**Patterns to follow:**
- Previous canonical-alignment PRs' README refreshes — list canonical entries first, leaf primitives next, non-canonical product surfaces last

**Test scenarios:**
- Test expectation: pure cleanup — assertion that `blocks/spinner.css` and `blocks/app-icon.css` no longer exist; assertion that they're absent from `BLOCK_FILES`
- Regression guard: `grep -r "wf-spinner\|wf-app-icon" services/landing` returns zero matches

**Verification:**
- `npm test` passes (likely test count adjusts down by the directory-content size)
- README accurately reflects the post-rewrite styles tree

---

## System-Wide Impact

- **Interaction graph:** New `ProvisioningStoryboard` clientEntry hydrates on Provisioning view; existing `StatusPoller` continues to drive the pending→Running transition (no interaction between the two — the storyboard times out and plateaus; the poller's route refresh swaps views regardless)
- **Error propagation:** The storyboard is purely client-side; if it errors, the user still sees the SSR-emitted DOM (step-0 active, ETA 25, bar 0%) — no functional regression, just no animation
- **State lifecycle risks:** None — no backend state changes, no persistent writes
- **API surface parity:** No API changes. The Session API endpoints are unchanged.
- **Integration coverage:** The view dispatch in `sessions/page.tsx` is the integration seam — the controller test already exercises Provisioning rendering; just update the DOM-shape assertions in U4/U5
- **Unchanged invariants:** The pending→Running transition logic in `StatusPoller`, the cancel intent dispatch in the sessions controller, the `pendingPhase` derivation in `derive.ts`, and the ingress probe in `ingress.ts` are all untouched

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Storyboard timer drifts between SSR-emitted state and hydration's first tick → visible flash | SSR emits exactly the state the storyboard's first tick will set (step-0 active, ETA 25, bar 0%). The storyboard's first `handle.update()` matches what's already in the DOM. |
| StatusPoller's `pending → running-pre-ingress` transition re-renders Provisioning, re-mounting the storyboard and rewinding elapsed to 0 | Elapsed is anchored to `sessionCreatedAt` (threaded through props from the Session record), not to mount time. Re-mounts compute elapsed from the same ISO timestamp and resume where they left off. Also resolves tab-backgrounding desync. |
| Backend transitions to Running before the storyboard's 25s plateau — view swaps mid-animation | Acceptable: the StatusPoller drives the route refresh, and the new view (Ready) renders cleanly. Brief visual transition is the cost of synthetic v1. |
| Backend stays Pending past 25s — storyboard plateaus on "Mounting preview server" indefinitely | After a 5s grace window past 25s elapsed, the storyboard degrades to a long-running honest display: ETA hidden, bar swaps to indeterminate stripes, active step's meta reads "taking longer than usual." Steady-state visuals never claim "0s remaining" for minutes. |
| Semi-random per-step timing produces a distribution that feels uneven (e.g., 7s on step 1, then 2s on steps 2–4) | Pick a reasonable distribution (e.g., monotonically reasonable: 2s, 4s, 8s, 6s, 5s) and seed-shuffle within constraints, not pure random. Tune during U3 implementation. |
| Storyboard mount fires before the card-shell DOM is queryable (race between Remix hydration and document parser) | `handle.queueTask` defers the first `document.querySelector` until after hydration settles (existing pattern in `cancel-button.tsx`'s `startSubmit`). |
| Retiring `spinner.css` / `app-icon.css` breaks something the grep missed | U6 is the last unit; if any consumer surfaces during impl (e.g., in a test fixture or a markdown screenshot), keep the file and defer retirement. The plan is to retire; the action is contingent. |
| U4's body Cancel removal lands before U5's header Cancel placement → Cancel-less window on `main` between commits | Dependency inverted: U5 ships first (adds header Cancel), U4 ships next (removes body Cancel). Every commit on the branch has at least one valid Cancel affordance. Single-PR shipping is the strong default; the inverted order makes partial-revert safe too. |
| The Hi-Fi's eyebrow dimensions (26h/gap 8) differ from canonical Blocks doc (24h/gap 7) | Adopt canonical. Note the drift in the PR description so the design author can resolve it (update Blocks doc or update Hi-Fi). |

---

## Documentation / Operational Notes

- README styles tree updated in U6
- The new `ProvisioningStoryboard` clientEntry is documented inline (file header comment) per the existing clientEntry doc-comment convention
- After merge, file a `/ce-compound` learning at `docs/solutions/design-patterns/` capturing the "synthetic storyboard for missing backend signal" pattern — could apply to future state-transition pages (Stopping, Failed) that lack rich backend telemetry
- No rollout, monitoring, or migration concerns — pure SSR-rendered UI change

---

## Sources & References

- **Design source of truth:** `docs/designs/Provisioning Hi-Fi.html`
- **Canonical blocks:** `docs/designs/OpenVoid Blocks.html` entry 06 (Eyebrow Pill)
- **Canonical compositions:** `docs/designs/OpenVoid Compositions.html` entry 02 (Stage)
- **Current Provisioning:** `services/landing/app/actions/sessions/components/provisioning.tsx`
- **Related code:** `services/landing/app/actions/sessions/page.tsx` (view dispatch), `services/landing/app/actions/sessions/client/status-poller.tsx`, `services/landing/app/actions/sessions/client/cancel-button.tsx`
- **Related prior plans:** `docs/plans/2026-05-11-001-refactor-align-landing-blocks-to-canonical-plan.md` (the canonical-alignment foundation this builds on; U6 of that plan — Eyebrow Pill scaffolding — is partially delivered here)
