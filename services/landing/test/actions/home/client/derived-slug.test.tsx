import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { DerivedSlug } from '../../../../app/actions/home/client/derived-slug.tsx'

describe('DerivedSlug (SSR fallback)', () => {
  it('renders nothing visible — the wrapper + slug span are page-owned', async () => {
    const html = await renderToString(
      <DerivedSlug targetId="prompt" slugId="lives-at-slug" wrapperId="lives-at-wrap" />,
    )
    assert.doesNotMatch(html, /<button\b/)
    assert.doesNotMatch(html, /<a\b/)
    assert.doesNotMatch(html, /composer-derived/)
  })
})
