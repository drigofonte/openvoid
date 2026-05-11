import { clientEntry, on, css, type Handle } from 'remix/ui'

/**
 * Suggestion-chips clientEntry. Renders the Hi-Fi-faithful
 * suggestion pills below the composer; clicking a pill replaces
 * the prompt textarea's content with the pill's `fill` text (the
 * `label` is the chip's visible text — typically a shorter handle
 * for the longer prompt).
 *
 * "Replace, not append" is the design call: clicking a second pill
 * discards the first, so users never accidentally stack unrelated
 * prompts.
 *
 * Targets the textarea by its known id (default `'prompt'`,
 * overridable via `targetId`) — set in `app/actions/home/page.tsx`.
 * After replacing the value the chip dispatches a synthetic `input`
 * event so any sibling clientEntries (auto-grow, derived slug,
 * start-session-button enable gate) see the change.
 *
 * SSR fallback: the chips render as plain `<button class="wf-sug">`
 * elements with the design's `::before` arrow glyph supplied by
 * the CSS recipe in `blocks/suggestion.css`. Without JS the chips are inert
 * — acceptable for chips that exist to speed up power users.
 */

export const SuggestionChips = clientEntry(
  import.meta.url,
  function SuggestionChips(
    handle: Handle<{
      targetId: string
      suggestions: Array<{ label: string; fill: string }>
    }>,
  ) {
    function pickChip(text: string) {
      const textarea = document.getElementById(handle.props.targetId)
      if (!(textarea instanceof HTMLTextAreaElement)) return
      textarea.value = text
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }

    return () => (
      <div class="wf-row" mix={css({ gap: '10px', flexWrap: 'wrap' })}>
        {handle.props.suggestions.map(({ label, fill }) => (
          <button
            type="button"
            class="wf-sug"
            data-suggestion={fill}
            mix={[
              css({ cursor: 'pointer' }),
              on<HTMLButtonElement>('click', () => pickChip(fill)),
            ]}
          >
            {label}
          </button>
        ))}
      </div>
    )
  },
)
