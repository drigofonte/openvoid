import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { AutoGrowTextarea } from '../../../../app/actions/home/client/auto-grow-textarea.tsx'

describe('AutoGrowTextarea (SSR fallback)', () => {
  it('renders nothing visible — the resize is a hydration-only enhancement', async () => {
    const html = await renderToString(<AutoGrowTextarea targetId="prompt" />)
    assert.doesNotMatch(html, /<button\b/)
    assert.doesNotMatch(html, /<a\b/)
    assert.doesNotMatch(html, /<textarea\b/)
  })

  it('accepts an optional maxHeight prop without rendering markup for it', async () => {
    const html = await renderToString(<AutoGrowTextarea targetId="prompt" maxHeight={500} />)
    assert.doesNotMatch(html, /<button\b/)
  })
})
