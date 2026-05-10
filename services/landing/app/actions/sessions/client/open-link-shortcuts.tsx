import { clientEntry, type Handle } from 'remix/ui'

/**
 * OpenLinkShortcuts — invisible clientEntry that wires
 * Cmd+Shift+1 / Cmd+Shift+2 (Ctrl+Shift+1/2 on Windows/Linux)
 * to open the agent / preview URL in a new tab. SSR fallback
 * returns `null` — the shortcut is a progressive-enhancement;
 * the visible buttons remain the primary affordance.
 *
 * Why Cmd/Ctrl + Shift + digit (not Cmd/Ctrl + digit alone):
 * every major browser reserves Cmd/Ctrl+digit at the OS-chrome
 * level to switch between browser tabs. The page never sees
 * those keydowns. Adding Shift escapes the reservation — Chrome,
 * Firefox, and Safari all let Cmd/Ctrl+Shift+digit reach the
 * page on both Mac and Windows.
 *
 * Browser-key event quirk: when Shift is held with a digit, the
 * `event.key` value is the SHIFTED character ("!" / "@" on a US
 * layout) rather than the digit itself. We match `event.code`
 * ("Digit1" / "Digit2") instead, which reflects the physical key
 * regardless of layout or modifier state.
 *
 * Suppression: the shortcut never triggers when the user is
 * focused on a text-input element (`<input>`, `<textarea>`, or
 * any `[contenteditable]`), nor when Alt is held — that prevents
 * collisions with native shortcuts a user might be in the middle
 * of pressing. The element-type exclusion is deliberate — a
 * body-only check (`activeElement === document.body`) would
 * suppress the shortcut on the very buttons that advertise
 * `⌘ ⇧ 1` / `⌘ ⇧ 2` as their kbd hint, since clicking a button
 * moves focus there.
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
          // Cmd OR Ctrl + Shift; reject Alt and missing modifiers.
          if (!(event.metaKey || event.ctrlKey)) return
          if (!event.shiftKey) return
          if (event.altKey) return
          // Use `event.code` (physical key) rather than `event.key`
          // (Shift-digit yields the symbol — "!" / "@").
          if (event.code !== 'Digit1' && event.code !== 'Digit2') return

          const active = document.activeElement
          const isTextInput =
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            (active instanceof HTMLElement && active.isContentEditable)
          if (isTextInput) return

          event.preventDefault()
          const href =
            event.code === 'Digit1' ? handle.props.chatHref : handle.props.previewHref
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
