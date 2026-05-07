import { clientEntry, on, css, type Handle } from 'remix/ui'

/**
 * Suggestion-chips clientEntry. Renders the wireframe-faithful
 * chip buttons; on click replaces the prompt textarea's content
 * with the chip text.
 *
 * "Replace, not append" was the design call (plan §274 Open
 * Questions, deferred to implementation). Cleaner UX: clicking a
 * second chip discards the first, the user is never accidentally
 * stacking unrelated prompts.
 *
 * Targets the textarea by its known id (`#prompt`) — set in
 * `app/actions/home/page.tsx`. After replacing the value the chip
 * dispatches a synthetic `input` event so any future listeners
 * (e.g. validators) see the change.
 *
 * SSR fallback: the chips are rendered as plain `<button
 * type="button">` elements. Without JS they are inert — no
 * placeholder text — which is acceptable for chips that exist to
 * speed up power users.
 */

export const SuggestionChips = clientEntry(
  import.meta.url,
  function SuggestionChips(
    handle: Handle<{ targetId: string; suggestions: string[] }>,
  ) {
    function pickChip(text: string) {
      const textarea = document.getElementById(handle.props.targetId)
      if (!(textarea instanceof HTMLTextAreaElement)) return
      textarea.value = text
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }

    return () => (
      <div class="wf-row" mix={css({ gap: '8px', flexWrap: 'wrap' })}>
        {handle.props.suggestions.map((text) => (
          <button
            type="button"
            class="wf-chip"
            data-suggestion={text}
            mix={[
              css({ cursor: 'pointer' }),
              on<HTMLButtonElement>('click', () => pickChip(text)),
            ]}
          >
            {text}
          </button>
        ))}
      </div>
    )
  },
)
