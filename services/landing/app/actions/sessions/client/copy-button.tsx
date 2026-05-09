import { clientEntry, on, type Handle } from 'remix/ui'

/**
 * CopyButton — clientEntry that copies a string to the clipboard
 * and briefly flips its label to confirm. Renders as a semantic
 * `<button class="wf-chip">`; without JS the button is focusable
 * but inert (clipboard requires the JS API).
 *
 * Behavior contract:
 *
 * - The state flip to "Copied" runs ONLY inside the resolved-
 *   promise branch of `navigator.clipboard.writeText`. A rejected
 *   write (permission denied, insecure context) leaves the label
 *   unchanged so users never see a false-success signal.
 *
 * - The 1.2s revert is scheduled via `handle.signal` so a fast
 *   re-click or unmount cancels it cleanly.
 */

export const CopyButton = clientEntry(
  import.meta.url,
  function CopyButton(
    handle: Handle<{
      value: string
      label?: string
      copiedLabel?: string
    }>,
  ) {
    let copied = false
    let revert: ReturnType<typeof setTimeout> | undefined

    handle.signal.addEventListener('abort', () => {
      if (revert) clearTimeout(revert)
    })

    async function onCopy() {
      try {
        await navigator.clipboard.writeText(handle.props.value)
      } catch {
        // Silent — surface no in-page UI for clipboard rejection.
        // Users in insecure contexts or with restricted permissions
        // see the label stay as "Copy"; nothing pretends success.
        return
      }
      copied = true
      handle.update()
      if (revert) clearTimeout(revert)
      revert = setTimeout(() => {
        copied = false
        revert = undefined
        handle.update()
      }, 1200)
    }

    return () => {
      const label = handle.props.label ?? 'Copy'
      const copiedLabel = handle.props.copiedLabel ?? 'Copied'
      return (
        <button
          type="button"
          class="wf-chip"
          mix={on<HTMLButtonElement>('click', onCopy)}
        >
          {copied ? copiedLabel : label}
        </button>
      )
    }
  },
)
