import { clientEntry, type Handle } from 'remix/ui'

/**
 * DerivedSlug — invisible clientEntry that updates the "lives at
 * <slug>.openvoid.dev" ghost line as the user types. The page
 * renders the wrapper `<div class="wf-livesat" data-hidden>` and
 * the inner `<span>` that holds the slug; this component only
 * updates the inner span's text content and toggles the wrapper's
 * `data-hidden` attribute.
 *
 * The opacity transition lives on the `.wf-livesat[data-hidden]`
 * CSS rule — toggling the attribute (not the inner span) is what
 * gates the fade-in / fade-out.
 *
 * v1 status: decorative. The slug doesn't drive the actual session
 * URL — the controller still redirects to `/sessions/:id`. The
 * client-side `slugify` mirrors the design HTML's algorithm; if a
 * real subdomain registry ships later, server-side derivation
 * becomes the source of truth and this client-side computation
 * should be replaced or removed.
 *
 * Cleanup: the input listener is registered with `handle.signal`.
 */

const MIN_PROMPT_LENGTH = 8
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'with', 'my',
  'that', 'this', 'from', 'on', 'in', 'it',
])

function slugify(value: string): string {
  if (!value) return ''
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(w))
    .slice(0, 3)
  return words.join('-') || 'untitled'
}

export const DerivedSlug = clientEntry(
  import.meta.url,
  function DerivedSlug(
    handle: Handle<{
      targetId: string
      slugId: string
      wrapperId: string
    }>,
  ) {
    if (typeof document !== 'undefined') {
      const textarea = document.getElementById(handle.props.targetId)
      const slugSpan = document.getElementById(handle.props.slugId)
      const wrapper = document.getElementById(handle.props.wrapperId)
      if (
        textarea instanceof HTMLTextAreaElement &&
        slugSpan instanceof HTMLSpanElement &&
        wrapper instanceof HTMLElement
      ) {
        const update = () => {
          const value = textarea.value.trim()
          if (value.length >= MIN_PROMPT_LENGTH) {
            slugSpan.textContent = slugify(value)
            wrapper.removeAttribute('data-hidden')
          } else {
            wrapper.setAttribute('data-hidden', '')
          }
        }
        // Run once at hydration so an SSR-rendered prompt that
        // already crosses the threshold reveals the slug on first
        // paint instead of waiting for the next keystroke.
        update()
        textarea.addEventListener('input', update, { signal: handle.signal })
      }
    }

    return () => null
  },
)
