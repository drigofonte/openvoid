import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { SuggestionChips } from '../../../../app/actions/home/client/suggestion-chips.tsx'

describe('SuggestionChips (SSR fallback)', () => {
  it('renders chips with class="wf-sug" and the visible label as text content', async () => {
    const html = await renderToString(
      <SuggestionChips
        targetId="prompt"
        suggestions={[
          { label: 'Notion-style notes', fill: 'A Notion-style note app...' },
          { label: 'URL shortener', fill: 'A URL shortener with...' },
        ]}
      />,
    )
    assert.match(html, /<button\b[^>]*\bclass="[^"]*\bwf-sug\b[^"]*"[^>]*>/)
    // Label is the visible text — fill is not rendered.
    assert.match(html, />Notion-style notes</)
    assert.match(html, />URL shortener</)
    assert.doesNotMatch(html, />A Notion-style note app/)
  })

  it('carries the fill text in data-suggestion for click handling', async () => {
    const html = await renderToString(
      <SuggestionChips
        targetId="prompt"
        suggestions={[{ label: 'Habit tracker', fill: 'A daily habit tracker with streaks.' }]}
      />,
    )
    assert.match(html, /data-suggestion="A daily habit tracker with streaks\."/)
  })
})
