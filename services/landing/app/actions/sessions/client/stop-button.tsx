import { clientEntry, on, css, type Handle } from 'remix/ui'

/**
 * StopButton — replaces the SSR-only `?confirm=stop` navigation
 * with an in-page confirm dialog. On click, opens a small modal
 * card with two CTAs: "Keep working" closes; "Yes, stop & save"
 * submits a hidden form with `intent=stop` to the same route.
 *
 * Server-rendered fallback (when JS is disabled or not yet
 * hydrated): the underlying `<a href="?confirm=stop">` link
 * still navigates to the SSR confirm page. Hydration intercepts
 * the click before the navigation fires.
 *
 * Pending state during submission: the confirm button flips to
 * "Stopping…" + disabled. Cleanup via handle.signal.
 */

export const StopButton = clientEntry(
  import.meta.url,
  function StopButton(handle: Handle<{ sessionId: string }>) {
    let dialogOpen = false
    let submitting = false

    function openDialog(event: Event) {
      event.preventDefault()
      dialogOpen = true
      handle.update()
    }

    function closeDialog() {
      if (submitting) return
      dialogOpen = false
      handle.update()
    }

    function startSubmit() {
      submitting = true
      handle.update()
      // Form submits natively — the navigation will unmount us
      // and hydrate fresh on the destination page.
    }

    return () => (
      <>
        <a
          class="wf-btn wf-btn-danger"
          href={`/sessions/${handle.props.sessionId}?confirm=stop`}
          mix={[css({ textDecoration: 'none' }), on<HTMLElement>('click', openDialog)]}
        >
          Stop & save
        </a>
        {dialogOpen ? (
          <div
            mix={[
              css({
                position: 'fixed',
                inset: 0,
                background: 'rgba(10, 10, 10, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                padding: '24px',
              }),
              on<HTMLElement>('click', (event) => {
                if (event.target === event.currentTarget) closeDialog()
              }),
            ]}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="stop-dialog-title"
              class="wf-card"
              mix={css({ padding: '32px', maxWidth: '480px', width: '100%' })}
            >
              <div class="wf-col" mix={css({ gap: '20px' })}>
                <div class="wf-col" mix={css({ gap: '6px' })}>
                  <span class="wf-eyebrow" mix={css({ color: 'var(--wf-danger)' })}>
                    Stop session
                  </span>
                  <h2 id="stop-dialog-title" class="wf-h2" mix={css({ margin: 0 })}>
                    Save your work and shut down?
                  </h2>
                  <p
                    class="wf-muted"
                    mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}
                  >
                    We'll commit the agent's edits to a fresh{' '}
                    <code class="wf-mono">feat/{handle.props.sessionId}</code>{' '}
                    branch and tear down the dev environment. This usually takes
                    a few seconds and isn't recoverable.
                  </p>
                </div>
                <div
                  class="wf-row"
                  mix={css({ gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' })}
                >
                  <button
                    type="button"
                    class="wf-btn wf-btn-ghost"
                    disabled={submitting || undefined}
                    mix={on<HTMLElement>('click', closeDialog)}
                  >
                    Keep working
                  </button>
                  <form
                    method="post"
                    action={`/sessions/${handle.props.sessionId}`}
                    mix={on<HTMLFormElement>('submit', startSubmit)}
                  >
                    <input type="hidden" name="intent" value="stop" />
                    <button
                      type="submit"
                      class="wf-btn wf-btn-danger"
                      disabled={submitting || undefined}
                    >
                      {submitting ? 'Stopping…' : 'Yes, stop & save'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </>
    )
  },
)
