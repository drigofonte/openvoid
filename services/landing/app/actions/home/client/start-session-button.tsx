import { clientEntry, on, css, type Handle } from 'remix/ui'

import { PROMPT_MIN_LENGTH } from './constants.ts'

/**
 * StartSessionButton — replaces the original `SubmitButton` for the
 * Create-page composer. Renders a `.wf-btn-go` button with the
 * label and an arrow SVG inside; the `⌘ ↵` kbd hint is rendered
 * by the page in a sibling `.wf-submit-area` span (NOT inside this
 * button — that contradicts the design's `.btn-go` shape).
 *
 * Behavior:
 *
 * - SSR fallback ships the button ENABLED so no-JS users can
 *   submit. The controller's `CreateSchema` validates prompt
 *   length server-side; gating at the SSR layer would block
 *   no-JS users entirely since the button is the only entry path
 *   on this page.
 * - On hydration, an `input` listener on the prompt textarea
 *   flips `disabled` based on `value.length >= 8`.
 * - A document-level `keydown` listener handles ⌘+Enter / Ctrl+Enter:
 *   reads the textarea value directly (NOT the button's disabled
 *   flag) to avoid the keydown-vs-input event-order race at the
 *   exact 8-char threshold; gates on `(metaKey || ctrlKey) &&
 *   key === 'Enter'` AND the form contains `document.activeElement`
 *   (out-of-form focuses don't trigger); calls `event.preventDefault()`
 *   before `form.requestSubmit()` so the textarea doesn't receive
 *   the default newline insertion.
 * - On submit, the label flips to `pendingLabel` (default "Starting
 *   session…") via the `handle.queueTask` deferred-flip pattern so
 *   the visual change doesn't race the browser's submit dispatch.
 *
 * Cleanup: both listeners are registered with `handle.signal`, so
 * unmount tears them down without manual bookkeeping.
 */

export const StartSessionButton = clientEntry(
  import.meta.url,
  function StartSessionButton(
    handle: Handle<{
      targetId: string
      label?: string
      pendingLabel?: string
      initialPrompt?: string
    }>,
  ) {
    let pending = false
    // Compute initial disabled state from the prop so SSR and the
    // first hydration render agree — without this, SSR emits the
    // button enabled (initial closure default) and hydration flips
    // it disabled, producing a visible black-to-grey flash on load.
    let disabled = (handle.props.initialPrompt ?? '').length < PROMPT_MIN_LENGTH

    function startSubmit() {
      handle.queueTask(() => {
        pending = true
        handle.update()
      })
    }

    if (typeof document !== 'undefined') {
      const textarea = document.getElementById(handle.props.targetId)
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.addEventListener(
          'input',
          () => {
            const next = textarea.value.length < PROMPT_MIN_LENGTH
            if (next !== disabled) {
              disabled = next
              handle.update()
            }
          },
          { signal: handle.signal },
        )

        document.addEventListener(
          'keydown',
          (event) => {
            if (!(event.metaKey || event.ctrlKey)) return
            if (event.key !== 'Enter') return
            const active = document.activeElement
            const form = textarea.form
            if (!form || !active || !form.contains(active)) return
            // Read the live textarea value to avoid the keydown
            // firing before the input listener has flipped the
            // disabled flag for the boundary character.
            if (textarea.value.length < PROMPT_MIN_LENGTH) return
            event.preventDefault()
            startSubmit()
            form.requestSubmit()
          },
          { signal: handle.signal },
        )
      }
    }

    return () => {
      const label = handle.props.label ?? 'Start session'
      const pendingLabel = handle.props.pendingLabel ?? 'Starting session…'
      return (
        <button
          type="submit"
          class="wf-btn-go"
          disabled={disabled || pending || undefined}
          mix={[css({ textDecoration: 'none' }), on<HTMLButtonElement>('click', startSubmit)]}
        >
          <span>{pending ? pendingLabel : label}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      )
    }
  },
)
