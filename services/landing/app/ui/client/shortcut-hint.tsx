import { clientEntry, css, type Handle } from 'remix/ui'

/**
 * ShortcutHint — renders the Cmd/Ctrl + Shift + <digit> kbd
 * combo platform-aware (⌘ on Mac, `Ctrl` elsewhere).
 *
 * SSR defaults to the Mac glyph, so Mac users (the dominant
 * platform for this tool) see the correct combo on first paint.
 * On hydration the platform is detected from `navigator.userAgent`
 * and the glyph swaps to `Ctrl` on Windows / Linux. Brief
 * one-frame flash there is acceptable for a kbd hint that's a
 * progressive-enhancement label, not a primary affordance.
 *
 * The detection uses `navigator.userAgent` rather than the
 * deprecated `navigator.platform`. `userAgentData.platform` is
 * better in principle but isn't supported by Safari at v1.
 */

export const ShortcutHint = clientEntry(
  import.meta.url,
  function ShortcutHint(handle: Handle<{ digit: '1' | '2' }>) {
    let isMac = true
    if (typeof navigator !== 'undefined') {
      isMac = /Mac/i.test(navigator.userAgent ?? '')
    }
    return () => (
      <span class="wf-row" mix={css({ gap: '2px' })}>
        <span class="wf-keycap">{isMac ? '⌘' : 'Ctrl'}</span>
        <span class="wf-keycap">⇧</span>
        <span class="wf-keycap">{handle.props.digit}</span>
      </span>
    )
  },
)
