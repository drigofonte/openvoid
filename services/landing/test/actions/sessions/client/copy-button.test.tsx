import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { CopyButton } from '../../../../app/actions/sessions/client/copy-button.tsx'

describe('CopyButton (SSR fallback)', () => {
  it('renders a focusable btn-ghost button with the default "Copy" label', async () => {
    const html = await renderToString(<CopyButton value="https://x" />)
    assert.match(html, /<button\b[^>]*\btype="button"[^>]*>/)
    assert.match(html, /<button\b[^>]*\bclass="btn-ghost"[^>]*>/)
    assert.match(html, />Copy</)
  })

  it('renders a custom label when provided', async () => {
    const html = await renderToString(<CopyButton value="x" label="Copy URL" />)
    assert.match(html, />Copy URL</)
  })
})
