import { clientEntry, type Handle } from 'remix/ui'

/**
 * OpenLinkShortcuts — invisible clientEntry that wires ⌘1 / ⌘2
 * (or Ctrl-1 / Ctrl-2 on non-mac) to open the agent / preview URL
 * in a new tab. SSR fallback returns `null` — the shortcut is a
 * progressive-enhancement; the visible buttons remain the primary
 * affordance.
 *
 * Suppression: the shortcut never triggers when the user is
 * focused on a text-input element (`<input>`, `<textarea>`, or
 * any `[contenteditable]`). The element-type exclusion is
 * deliberate — a body-only check (`activeElement === document.body`)
 * would suppress the shortcut on the very buttons that advertise
 * `⌘1` / `⌘2` as their kbd hint, since clicking the button moves
 * focus there. Element-type exclusion preserves the user's
 * text-input experience without breaking the shortcut on its
 * own buttons.
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
          if (!(event.metaKey || event.ctrlKey)) return
          if (event.key !== '1' && event.key !== '2') return

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
