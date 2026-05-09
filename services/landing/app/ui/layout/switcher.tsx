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
 * `.switcher-limit-N` classes pre-baked into `composition.css`.
 */
let switcherCounter = 0

/**
 * Every Layout Switcher — a row of children that switches to a stack
 * when the container drops below `threshold`. Layout mechanics live
 * in `composition.css`'s `.switcher` rule; this component sets the
 * `--threshold` and `--space` custom properties.
 *
 * The original React port used `useId` + `useEffect` to inject a
 * per-instance `<style>` rule for the dynamic `limit`. The Remix
 * port emits the same rule server-side instead, scoped to a
 * per-instance class drawn from a module counter. When `limit`
 * matches the Every Layout default of 4, the rule is omitted —
 * `composition.css`'s base `.switcher` rule already covers that
 * case.
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
    const overflow = limit + 1
    // `innerHTML` (vs `<style>{rule}</style>`) keeps the `>` combinator
    // and other selector punctuation from getting HTML-escaped — Remix
    // 3's renderer otherwise emits `&gt;`, which browsers do not decode
    // inside <style> (a raw-text element).
    const limitRule = `.${scopedClass} > :nth-last-child(n+${overflow}), .${scopedClass} > :nth-last-child(n+${overflow}) ~ * { flex-basis: 100%; }`
    return (
      <>
        {limit !== DEFAULT_LIMIT && <style innerHTML={limitRule} />}
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
