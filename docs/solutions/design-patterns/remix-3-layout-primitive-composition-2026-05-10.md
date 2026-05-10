---
title: "Compose with the layout primitives — one outer max-width, one Stack"
date: 2026-05-10
category: design-patterns
module: services/landing
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - Composing a Remix 3 page from Every Layout primitives (Stack, Switcher, Cover, Cluster)
  - Multiple sibling sections in a Stack should share one constrained max-width
  - A flex-based section (Switcher, Cluster, custom flex container) sits next to block sections under the same Stack
  - Card children of a Switcher carry rich internal content (URL rows, action buttons) and must split-or-stack predictably
  - Per-card bottom-row alignment must hold across cards of unequal middle-content height
related_components:
  - services/landing/app/actions/sessions/components/ready.tsx
  - services/landing/public/styles/composition.css
  - services/landing/public/styles/blocks.css
  - services/landing/app/ui/layout/stack.tsx
  - services/landing/app/ui/layout/switcher.tsx
  - services/landing/app/ui/layout/cover.tsx
tags:
  - remix-3
  - layout-primitives
  - every-layout
  - stack
  - switcher
  - cube-css
  - landing
---

# Compose with the layout primitives — one outer max-width, one Stack

## Context

During the Ready page redesign on 2026-05-10 (`services/landing/app/actions/sessions/components/ready.tsx`), the first composition pass plumbed a `maxWidth` prop into each major section of the view — Hero (`var(--w-prose)`), the Duo card row (`var(--w-stage)`), and the SplitTip (`var(--w-stage)`). At the same nominal max-width, the SplitTip rendered visibly narrower than the cards row above it. The user's review caught the deeper issue:

> "Feels like you are not really using the layout components to create the composition. The cards should be in a switcher and the heading, cards row and instructions row should be in a stack."

The shape was right (Cover → Stack → sections), but width was being constrained at the wrong level. Identical `max-width` declarations on flex children produced different rendered widths because each section's internal flex layout interacted with `max-width` differently. The fix was to delete every per-row max-width and constrain width once, on a single wrapper around the Stack.

A second, related issue surfaced in the same session: the two cards inside the Switcher had different middle-content heights, so their bottom rows (URL row + action button) didn't align. `class="stack-split"` on the top section was the right Every Layout pattern, but it only worked once the card primitive itself became a flex column.

## Guidance

**Constrain width once at the outermost wrapper, let Stack do the rest.**

Every Layout's Stack is `display: flex; flex-direction: column` (see `services/landing/public/styles/composition.css`), and flex's default `align-items: stretch` makes children fill the Stack's width on the cross axis. So if you wrap the Stack in a single max-width container, every child fills that width automatically — no per-row plumbing.

Canonical shape:

```jsx
<Cover ...>
  <div mix={css({
    maxWidth: '920px',           // single source of truth
    marginLeft: 'auto',
    marginRight: 'auto',
    width: '100%',
  })}>
    <Stack space="...">
      <Hero />        {/* uses an inner narrower wrapper if needed */}
      <Duo />         {/* fills Stack width via stretch */}
      <SplitTip />    {/* fills Stack width via stretch */}
      <DoneLine />    {/* fills Stack width via stretch */}
    </Stack>
  </div>
</Cover>
```

Broken shape (avoid):

```jsx
<Cover ...>
  <Stack space="...">
    <Hero mix={css({ maxWidth: 'var(--w-prose)', ... })} />
    <Duo  mix={css({ maxWidth: 'var(--w-stage)', ... })} />
    <SplitTip mix={css({ maxWidth: 'var(--w-stage)', ... })} />
    {/* SplitTip renders narrower than Duo despite identical max-width */}
  </Stack>
</Cover>
```

A section that needs to be *narrower* than the stage (Hero, set to `--w-prose`) gets its own inner wrapper — but that constraint lives *inside* the Hero, not as a sibling-of-Stack concern.

**Stack-split for vertical alignment across cards.** When two Switcher children have different middle-content heights but their bottom rows must align, wrap the top block in `<div class="stack-split">`. The Composition rule is `.stack-split { margin-block-end: auto }`, which only absorbs free space when the parent Stack has a definite height. So the card primitive needs to be a flex column with a stretching inner Stack:

```css
/* services/landing/public/styles/blocks.css */
.wf-card-elev {
  display: flex;
  flex-direction: column;
  /* …other rules… */
}
.wf-card-elev > .stack {
  flex: 1;
}
```

## Why This Matters

**1. Predictability.** Stack's `align-items: stretch` is doing the work — a child with `width: auto` fills the cross axis. Adding per-row max-widths layers a *second* mechanism on top. `display: flex` children with internal flex layouts (like the SplitTip, which is `display: flex` itself) interact with `max-width` differently than plain block children: the inner flex can collapse the outer width to content width, even when `max-width` says otherwise. The Ready page proved this empirically — identical `max-width: var(--w-stage)` rendered visibly narrower on SplitTip than on the Switcher above it.

**2. Single source of truth.** One max-width is one decision. When the Ready stage moved from 760 → 920px (the editorial hero is wider than the canonical `--w-stage` composer surface), it was a one-line change. Per-row max-widths drift: someone tweaks one section, forgets the others, and rows end at different x-positions.

**3. Trust the primitive.** Every Layout primitives are designed for cross-axis stretch. Stack stretches. Switcher's `flex-basis: calc((threshold - 100%) * 999)` recipe (`composition.css`) makes children either share a row equally or each take 100%. Working *with* the primitive's defaults takes less code than working around them.

## When to Apply

- Any vertical composition (Cover/Stack-based) where multiple sections should share a max-width.
- Any time you find yourself adding the same max-width prop to multiple sibling components inside a Stack — that's the smell. Lift it once.
- Carries forward to other pages in `services/landing/` (Home, Create, future session-state redesigns) — same composition shape.
- For card grids in a Switcher where bottom rows must align, reach for `class="stack-split"` and ensure the card primitive is `display: flex; flex-direction: column` with the inner Stack `flex: 1`.

## Examples

### 1. Outer wrapper + Stack

`services/landing/app/actions/sessions/components/ready.tsx`:

```jsx
<Cover
  minHeight="calc(100vh - var(--h-header))"
  space="var(--sp-10)"
  centered={
    <div
      mix={css({
        maxWidth: '920px',
        marginLeft: 'auto',
        marginRight: 'auto',
        width: '100%',
      })}
    >
      <Stack space="var(--sp-10)">
        <Hero />
        <Duo agentUrl={agentUrl} previewUrl={previewUrl} />
        <SplitTip />
        <StopButton sessionId={sessionId} />
        <OpenLinkShortcuts chatHref={agentUrl} previewHref={previewUrl} />
      </Stack>
    </div>
  }
/>
```

One max-width. Five Stack children, each filling 920px without any per-section width plumbing.

### 2. Hero with narrower inner wrapper

`ready.tsx`:

```jsx
function Hero() {
  return () => (
    <div
      mix={css({
        textAlign: 'center',
        maxWidth: 'var(--w-prose)',
        marginLeft: 'auto',
        marginRight: 'auto',
        width: '100%',
      })}
    >
      <Stack space="var(--sp-6)">
        {/* …pill, h1, subtitle… */}
      </Stack>
    </div>
  )
}
```

The Hero needs to be narrower than the 920px stage (prose ≈ 60ch), but that constraint lives *inside* the Hero's own wrapper — not propagated outward as a sibling-of-Stack concern. The Stack still stretches its child to 920px; the inner div caps at `--w-prose` and self-centers via `margin: 0 auto`.

### 3. Switcher children that need to shrink

`services/landing/public/styles/composition.css`:

```css
.switcher {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space, 1rem);
}

.switcher > * {
  flex-grow: 1;
  flex-basis: calc((var(--threshold, 30rem) - 100%) * 999);
  /* Allow children to shrink below their min-content size.
     Without this, the default `min-width: auto` keeps each child
     at min-content (a wide unbroken URL inside, a long button
     label) and the row wraps even when the calc above says split. */
  min-inline-size: 0;
}
```

A related Every Layout amendment in the same composition layer: the Switcher's recipe silently fails when a child's min-content (a long unbroken URL, a wide button label) exceeds half the container, because flex's default `min-width: auto` won't let the child shrink past min-content. `min-inline-size: 0` is the escape hatch.

### 4. Stack-split for cross-card vertical alignment

`ready.tsx` + `blocks.css`:

```jsx
<Card variant="elevated" accentTop>
  <Stack space="var(--sp-7)">
    <div class="stack-split">
      <Cluster space="var(--sp-5)" align="flex-start">
        {/* icon + heading + description */}
      </Cluster>
    </div>
    <UrlRow url={agentUrl}>{/* … */}</UrlRow>
    <Cluster justify="flex-start">
      <a class="wf-btn-action wf-btn-action-pri" ...>Open chat</a>
    </Cluster>
  </Stack>
</Card>
```

```css
.wf-card-elev {
  display: flex;
  flex-direction: column;
  /* …other rules… */
}
.wf-card-elev > .stack { flex: 1; }
```

Both cards in the Switcher are the same height (Switcher's `align-items: stretch`), and making `.wf-card-elev` a flex column with the inner Stack stretched gives `.stack-split` a definite height to push against. The URL row + action button anchor to the bottom of each card regardless of how many lines the description wraps to.

## Notes

- The outer wrapper needs `width: 100%` so it stretches up to its `max-width`. Inside Cover's `flex-direction: column` with the default stretch behavior, omitting `width: 100%` happens to work; in some other block contexts the wrapper would shrink to content width. Always include it — cheap insurance against future container changes.
- This learning is specific to the Every Layout primitives in `services/landing/app/ui/layout/` (Stack, Switcher, Cover, Cluster, Sidebar, Center) backed by the rules in `services/landing/public/styles/composition.css`. Different layout systems (Tailwind utilities, MUI Grid, CSS Grid auto-fit) have different defaults — the "stretch is the default; constrain once on the outside" reasoning depends on Stack being a flexbox column.
- The Ready stage uses `920px` directly rather than the canonical `var(--w-stage)` (760px). That's intentional — it's an editorial hero, not a composer surface. The pattern (single outer wrapper) applies regardless of which token or literal value you pick; the lesson is that there should be exactly one of them.

## Related

- `docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md` — peer Remix 3 pitfall in the same module: SSR HTML attribute names (`defaultValue` lowercases silently). Different facet of the same Remix-3-in-`services/landing/` surface.
- `docs/plans/2026-05-09-001-feat-landing-layout-primitives-remix-port-plan.md` — the original layout-primitives port that introduced Stack / Switcher / Cover / Cluster / Sidebar / Reel / AspectFrame / Grid into `services/landing/`.
- `docs/plans/2026-05-09-002-feat-ready-page-redesign-plan.md` — the Ready page redesign plan where this learning surfaced.
