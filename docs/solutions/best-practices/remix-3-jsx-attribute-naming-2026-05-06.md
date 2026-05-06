---
title: Remix 3 SSR uses HTML attribute names — `defaultValue` lowercases silently
date: 2026-05-06
category: best-practices
module: services/landing
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - Writing JSX in services/landing (or any Remix 3 project with jsxImportSource remix/ui)
  - Porting React or Next.js form components to Remix 3
  - Reviewing PRs that touch <input>, <textarea>, <select>, or other HTML-attribute-rich elements
  - Debugging a "field renders blank" or "default selection missing" report
related_components:
  - services/landing/app/ui/input.tsx
  - services/landing/app/ui/textarea.tsx
tags:
  - remix-3
  - remix-ui
  - jsx-attributes
  - ssr
  - input-primitive
  - react-compat-trap
  - html-attributes
  - landing-page
---

# Remix 3 SSR uses HTML attribute names — `defaultValue` lowercases silently

## Context

Remix 3 beta (`@remix-run/ui@0.1.1`) is configured with the React JSX transform — `services/landing/tsconfig.json` sets `"jsx": "react-jsx"` and `"jsxImportSource": "remix/ui"`. This makes React idioms feel native: `className`, `htmlFor`, `defaultValue`, `onChange` all type-check and compile. The DOM type declarations at `node_modules/.pnpm/@remix-run+ui@0.1.1/node_modules/@remix-run/ui/dist/runtime/dom.d.ts` even bless `defaultValue?: Trackable<string | undefined>` on input elements — the prop IS in the type surface.

But Remix 3's SSR renderer is not React. It emits raw HTML directly, and unknown attribute names are lowercased verbatim with no React-to-HTML translation layer. Only a small allowlist of camelCase props is special-cased; everything else gets dumped as a non-standard lowercase attribute the browser silently ignores.

The trap is sharp because:

- TypeScript accepts the prop (no compile error).
- `pnpm typecheck` passes.
- Unit tests pass (the JSX renders, no exception).
- The page loads with no console warning.
- The bug surfaces only when a human looks at the form and notices the field is empty.

This was caught in Unit 3 of the landing redesign: `<Input defaultValue="main">` shipped to HTML as `<input defaultvalue="main">`, the browser ignored it, the branch field rendered blank, and the regression slipped past every automated gate.

## Guidance

**For `<input>` elements:** pass the initial value as `value=`, not `defaultValue=`. HTML's `value` attribute IS the initial value (it sets the `defaultValue` DOM property at parse time). Since Remix 3 SSR has no client-side reconciliation that would treat `value=` as controlled, this is both correct and idiomatic.

```tsx
// Bad — silently broken
<input type="text" name="branch" defaultValue="main" />

// Good
<input type="text" name="branch" value="main" />
```

**For `<textarea>` elements:** render the initial content as child text. HTML `<textarea>` has no `value` attribute at all — the initial content is the element's text children.

```tsx
// Bad — silently broken
<textarea name="notes" defaultValue="hello" />

// Good
<textarea name="notes">hello</textarea>
```

**General principle:** in Remix 3 SSR, prefer HTML attribute names over React-style camelCase aliases. Only the following camelCase props are translated; everything else is lowercased verbatim. From `@remix-run/ui/dist/runtime/diff-props.js`:

```js
function normalizePropName(name, isSvg) {
  if (name.startsWith('aria-') || name.startsWith('data-')) return { attr: name }
  if (name === 'className') return { attr: 'class' }
  if (!isSvg) {
    if (name === 'htmlFor') return { attr: 'for' }
    if (name === 'tabIndex') return { attr: 'tabindex' }
    if (name === 'acceptCharset') return { attr: 'accept-charset' }
    if (name === 'httpEquiv') return { attr: 'http-equiv' }
    return { attr: name.toLowerCase() }   // unknown attrs lowercased verbatim
  }
  return normalizeSvgAttribute(name)
}
```

The full safe-list is: `aria-*`, `data-*`, `className`, `htmlFor`, `tabIndex`, `acceptCharset`, `httpEquiv`. Everything else camelCase is a trap.

When wrapping primitives in your own components (e.g. `services/landing/app/ui/input.tsx`, `services/landing/app/ui/textarea.tsx`), the component-level prop name can stay `defaultValue` (it IS semantically the server-rendered initial value) — just translate it to HTML at the leaf:

```tsx
// services/landing/app/ui/input.tsx — internally
<input type="text" name={name} value={defaultValue} ... />
```

## Why This Matters

The bug is silent across every automated check:

- No TypeScript error — the prop is in the declared type surface.
- No test failure — the element renders, just with wrong attributes.
- No runtime warning — Remix 3's renderer does not warn on lowercased unknowns.
- No visible error — the page loads cleanly.

It surfaces as UX regression: form fields render blank, default selections are lost, focus rings land on the wrong element, and forms can submit wrong defaults silently. In a form-heavy flow, several broken fields can ship before anyone notices.

The class of affected camelCase props is large. Every one of these is silently broken in Remix 3 SSR:

- `defaultValue`, `defaultChecked`, `defaultSelected`
- `crossOrigin`, `encType`, `formAction`, `formEncType`, `formMethod`, `formNoValidate`, `formTarget`
- `maxLength`, `minLength`, `noValidate`, `readOnly`, `autoFocus`, `autoComplete`, `autoCapitalize`, `autoCorrect`
- `allowFullScreen`, `contentEditable`, `spellCheck`, `srcSet`, `srcDoc`, `useMap`
- `dateTime`, `colSpan`, `rowSpan`, `frameBorder`, `marginHeight`, `marginWidth`

(Most event handler names — `onClick`, `onChange`, etc. — are typically routed through Remix 3's own event system via `mix={on('click', ...)}`, not as HTML attributes; verify the binding path before using.)

If you came from React or Next.js, your muscle memory for forms is wrong here.

## When to Apply

- Any JSX written in `services/landing/` (or any Remix 3 project with `jsxImportSource: 'remix/ui'` in `tsconfig.json`).
- Porting React or Next.js form components to Remix 3 — audit every camelCase HTML attribute, not just `defaultValue`.
- Reviewing PRs that touch `<input>`, `<textarea>`, `<select>`, `<form>`, `<img>`, or any element with HTML-attribute-rich props. Grep for `defaultValue=`, `crossOrigin=`, `readOnly=`, `autoFocus=`, etc. as a quick smell check.
- When debugging a "field renders blank" or "default selection missing" report — view-source first, look for lowercased attributes like `defaultvalue=`.

## Examples

### Input: before / after

Source:

```tsx
// Broken
<input type="text" name="branch" defaultValue="main" />
```

Rendered HTML:

```html
<input type="text" name="branch" defaultvalue="main">
```

Browser behavior: `defaultvalue` is not a standard HTML attribute. The field renders empty.

Source:

```tsx
// Working
<input type="text" name="branch" value="main" />
```

Rendered HTML:

```html
<input type="text" name="branch" value="main">
```

Browser behavior: `value` sets the initial text. Field renders with `main` pre-filled and remains user-editable (Remix 3 does no controlled-input reconciliation).

### Textarea: before / after

Source:

```tsx
// Broken
<textarea name="notes" defaultValue="hello world" />
```

Rendered HTML:

```html
<textarea name="notes" defaultvalue="hello world"></textarea>
```

Browser behavior: empty textarea. `defaultvalue` is ignored; there are no children.

Source:

```tsx
// Working
<textarea name="notes">hello world</textarea>
```

Rendered HTML:

```html
<textarea name="notes">hello world</textarea>
```

Browser behavior: textarea renders with `hello world` as initial content.

### Wrapper component: keep the prop name, fix the leaf

`services/landing/app/ui/input.tsx`:

```tsx
type InputProps = {
  name: string
  defaultValue?: string  // semantically correct at the API boundary
  // ...
}

export function Input() {
  return ({ name, defaultValue, ... }: InputProps) => (
    <input
      type="text"
      name={name}
      value={defaultValue}   // translate to HTML at the leaf
      // ...
    />
  )
}
```

`services/landing/app/ui/textarea.tsx`:

```tsx
export function Textarea() {
  return ({ name, defaultValue, ... }: TextareaProps) => (
    <textarea name={name} ...>
      {defaultValue}
    </textarea>
  )
}
```

The component's external API still reads as React-idiomatic; only the HTML-leaf rendering is corrected.

## Related

- `services/landing/app/ui/input.tsx` — primitive that consumes this guidance
- `services/landing/app/ui/textarea.tsx` — same
- PR [#18](https://github.com/drigofonte/openvoid/pull/18) — drive-by fix that surfaced this
- `docs/plans/2026-05-05-002-feat-landing-page-redesign-plan.md` — the redesign plan
