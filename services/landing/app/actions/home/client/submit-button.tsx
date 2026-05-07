import { clientEntry, on, type Handle } from 'remix/ui'

/**
 * Submit-button clientEntry — wraps the Create form's submit
 * button with a "Starting…" pending state and double-submit
 * defence. On click, flips a pending closure variable and disables
 * the button before the form submits natively. The hidden
 * `idempotencyKey` field is the upstream-side double-submit guard;
 * this is purely UX feedback so the user knows the button worked.
 *
 * SSR fallback: the underlying <button type="submit"> works
 * without JS — the form posts, the controller redirects, the
 * page navigates. Hydration adds the visual feedback.
 *
 * Cleanup via handle.signal: when the form's POST navigates the
 * page, the unmount aborts handle.signal and there's nothing to
 * clean up (no timers, no listeners we manage manually).
 */

export const SubmitButton = clientEntry(
  import.meta.url,
  function SubmitButton(handle: Handle<{ label: string }>) {
    let pending = false

    function startSubmit() {
      // Schedule the visual flip via queueTask so it runs AFTER the
      // form's native submit event has fired. Mutating `pending` and
      // calling `handle.update()` synchronously inside the click
      // handler would race with the browser's submit dispatch and
      // could swap out the button (or its disabled state) before
      // `submit` reaches the form.
      handle.queueTask(() => {
        pending = true
        handle.update()
      })
    }

    return () => (
      <button
        type="submit"
        class="wf-btn wf-btn-acc"
        disabled={pending || undefined}
        mix={on<HTMLButtonElement>('click', startSubmit)}
      >
        {pending ? 'Starting…' : handle.props.label}
      </button>
    )
  },
)
