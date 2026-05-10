import { clientEntry, type Handle } from 'remix/ui'

/**
 * OpenLinkShortcuts — invisible clientEntry that wires plain
 * `1` / `2` to open the agent / preview URL in a new tab. SSR
 * fallback returns `null` — the shortcut is a
 * progressive-enhancement; the visible buttons remain the primary
 * affordance.
 *
 * Why plain digits, not Cmd/Ctrl-modified: every major browser
 * intercepts Cmd+number (Mac) and Ctrl+number (Windows/Linux) at
 * the OS-chrome level to switch tabs. The page never sees those
 * keydowns, so a `metaKey || ctrlKey` filter would render the
 * shortcut a no-op on every platform. Plain digits give us a
 * single binding that works identically on Mac, Windows, and
 * Linux — and keeps the on-screen kbd hint a single key per
 * platform rather than a platform-aware glyph.
 *
 * Suppression: the shortcut never triggers when the user is
 * focused on a text-input element (`<input>`, `<textarea>`, or
 * any `[contenteditable]`), nor when a modifier (Alt / Meta /
 * Ctrl) is held — that prevents collisions with native shortcuts
 * a user might be in the middle of pressing. The element-type
 * exclusion is deliberate — a body-only check
 * (`activeElement === document.body`) would suppress the shortcut
 * on the very buttons that advertise `1` / `2` as their kbd hint,
 * since clicking the button moves focus there. Element-type
 * exclusion preserves the user's text-input experience without
 * breaking the shortcut on its own buttons.
 *
 * Cleanup: the keydown listener is registered with `handle.signal`,
 * so unmount tears it down without any manual bookkeeping.
 */

export const OpenLinkShortcuts = clientEntry(
  import.meta.url,
  function OpenLinkShortcuts(
    handle: Handle<{ chatHref: string; previewHref: string }>,
  ) {
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== '1' && event.key !== '2') return
          // Skip when the user is mid-press of a native shortcut
          // (Cmd+1 / Ctrl+1 / Alt+1 / Shift+1). Browsers intercept
          // Cmd/Ctrl+digit at the chrome level so we'd rarely see
          // those keydowns anyway, but the explicit filter keeps
          // Alt/Shift combinations from accidentally triggering.
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return

          const active = document.activeElement
          const isTextInput =
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            (active instanceof HTMLElement && active.isContentEditable)
          if (isTextInput) return

          event.preventDefault()
          const href =
            event.key === '1' ? handle.props.chatHref : handle.props.previewHref
          // window.open returning null (popup-blocked, e.g., Safari
          // with strict pop-up blocking) is silent — same pattern
          // as CopyButton's clipboard-denial silence.
          window.open(href, '_blank', 'noopener,noreferrer')
        },
        { signal: handle.signal },
      )
    }

    return () => null
  },
)
