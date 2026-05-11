import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface SwitcherProps {
  /**
   * Inline-size at which the layout switches between row and column.
   * Defaults to `30rem`.
   */
  threshold?: string
  /** Gap between children. Defaults to `var(--space-s)`. */
  space?: string
  /**
   * Maximum number of children that share a row before all children
   * collapse to full-width. Defaults to `4` (the Every Layout default).
   * When the value differs from the default, this component emits an
   * SSR-only sibling `<style>` block carrying the `:nth-last-child`
   * rule that enforces the limit.
   */
  limit?: number
  id?: string
  children?: RemixNode
}

const DEFAULT_LIMIT = 4

/**
 * Module-scoped counter — increments once per `<Switcher>` evaluation.
 * Each instance captures a stable scoped class for the lifetime of
 * the SSR pass (and the SSR-rendered HTML keeps that class for the
 * lifetime of the page). The counter restarts at process boot, so
 * IDs are not stable across server restarts — but the `<style>`
 * block that targets each ID is co-located with the `<div>` it
 * scopes, so cross-request stability is not required.
 *
 * If many `<Switcher limit={...}>` instances ship and the per-instance
 * `<style>` blocks become noisy, switch to enumerated
 * `.switcher-limit-N` classes pre-baked into `layout-primitives/switcher.css`.
 */
let switcherCounter = 0

/**
 * Every Layout Switcher — a row of children that switches to a stack
 * when the container drops below `threshold`. Layout mechanics live
 * in `layout-primitives/switcher.css`'s `.switcher` rule; this component sets the
 * `--threshold` and `--space` custom properties.
 *
 * A non-default `limit` emits a server-rendered sibling `<style>`
 * carrying the `:nth-last-child(n+limit+1)` rule, scoped to a
 * per-instance class. layout-primitives/switcher.css can't pre-bake the rule
 * because the limit is variable; Remix 3 has no client-time
 * style-injection hook, so SSR is the only place to emit it. When
 * `limit` matches the Every Layout default of 4, the rule is
 * omitted — layout-primitives/switcher.css's base `.switcher` rule covers it.
 */
export function Switcher() {
  const scopedClass = `switcher-${++switcherCounter}`
  return ({
    threshold = '30rem',
    space = 'var(--space-s)',
    limit = DEFAULT_LIMIT,
    id,
    children,
  }: SwitcherProps) => {
    // `innerHTML` (vs `<style>{rule}</style>`) keeps the `>` combinator
    // and other selector punctuation from getting HTML-escaped — Remix
    // 3's renderer otherwise emits `&gt;`, which browsers do not decode
    // inside <style> (a raw-text element).
    const limitStyle =
      limit !== DEFAULT_LIMIT ? (
        <style
          innerHTML={`.${scopedClass} > :nth-last-child(n+${limit + 1}), .${scopedClass} > :nth-last-child(n+${limit + 1}) ~ * { flex-basis: 100%; }`}
        />
      ) : null
    return (
      <>
        {limitStyle}
        <div
          class={`switcher ${scopedClass}`}
          id={id}
          mix={css({ '--threshold': threshold, '--space': space })}
        >
          {children}
        </div>
      </>
    )
  }
}
