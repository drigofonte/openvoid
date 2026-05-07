import { clientEntry, on, type Handle } from 'remix/ui'

/**
 * CancelButton — wraps the Provisioning view's cancel form with a
 * pending state ("Cancelling…" while the POST is in flight).
 *
 * No confirm step: cancel during provisioning is a low-cost user
 * action (nothing was saved yet) and adding a confirm dialog would
 * just be friction. The button flips disabled+label on submit so
 * a panicked user can't double-fire DELETE during the brief
 * navigation window.
 *
 * Server-rendered fallback: the underlying `<form>` submits
 * natively. Hydration adds the pending visual.
 */

export const CancelButton = clientEntry(
  import.meta.url,
  function CancelButton(handle: Handle<{ sessionId: string }>) {
    let submitting = false

    function startSubmit() {
      // Defer the visual flip via queueTask for the same reason
      // submit-button.tsx does — synchronous handle.update() inside
      // a submit-side handler can race with the browser's native
      // submit dispatch and short-circuit the navigation.
      handle.queueTask(() => {
        submitting = true
        handle.update()
      })
    }

    return () => (
      <form
        method="post"
        action={`/sessions/${handle.props.sessionId}`}
        mix={on<HTMLFormElement>('submit', startSubmit)}
      >
        <input type="hidden" name="intent" value="cancel" />
        <button
          type="submit"
          class="wf-btn wf-btn-ghost"
          disabled={submitting || undefined}
        >
          {submitting ? 'Cancelling…' : 'Cancel'}
        </button>
      </form>
    )
  },
)
