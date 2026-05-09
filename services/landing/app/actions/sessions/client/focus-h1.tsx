import { clientEntry, type Handle } from 'remix/ui'

/**
 * FocusH1 — invisible clientEntry that moves keyboard focus to the
 * page `<h1>` on hydration. Run on the `/sessions/:id` route so the
 * arriving user (and screen reader) lands on the heading rather
 * than wherever the previous page had focus.
 *
 * Targets `main h1.wf-h1[tabindex]` — only the session-state
 * components opt in by adding `tabindex={-1}` to their h1, which
 * makes the heading programmatically focusable without inserting
 * it into the Tab order.
 *
 * Defers via `queueTask` so the focus call lands after Remix's
 * hydration pass has settled. `preventScroll: true` keeps the
 * viewport stable; the heading is already at the top of `<main>`.
 */

export const FocusH1 = clientEntry(
  import.meta.url,
  function FocusH1(handle: Handle<Record<string, never>>) {
    handle.queueTask(() => {
      if (handle.signal.aborted) return
      const heading = document.querySelector<HTMLElement>('main h1.wf-h1[tabindex]')
      heading?.focus({ preventScroll: true })
    })

    return () => null
  },
)
