import { clientEntry, type Handle } from 'remix/ui'

/**
 * AutoGrowTextarea — invisible clientEntry that grows the prompt
 * textarea up to a max height as the user types. Returns `null` —
 * the textarea is rendered by the page; this component only wires
 * the resize behavior.
 *
 * Critical: the resize routine fires once at hydration in addition
 * to on `input`. After a controller validation failure re-renders
 * the page with `previousValues.prompt` in the textarea, the
 * SSR-rendered multi-line content would otherwise clip at the
 * default rows height until the user typed a character; the
 * hydration-time call ensures the preserved prompt is sized
 * correctly on first paint.
 *
 * Cleanup: the input listener is registered with `handle.signal`,
 * so unmount tears it down without manual bookkeeping.
 */

const DEFAULT_MAX_HEIGHT = 360

export const AutoGrowTextarea = clientEntry(
  import.meta.url,
  function AutoGrowTextarea(
    handle: Handle<{ targetId: string; maxHeight?: number }>,
  ) {
    if (typeof document !== 'undefined') {
      const textarea = document.getElementById(handle.props.targetId)
      if (textarea instanceof HTMLTextAreaElement) {
        const maxHeight = handle.props.maxHeight ?? DEFAULT_MAX_HEIGHT
        const resize = () => {
          textarea.style.height = 'auto'
          textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px'
        }
        // Size correctly on first paint for SSR-rendered multi-line
        // `previousValues.prompt` content.
        resize()
        textarea.addEventListener('input', resize, { signal: handle.signal })
      }
    }

    return () => null
  },
)
