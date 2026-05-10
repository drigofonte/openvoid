import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Logo } from '../../app/ui/logo.tsx'

describe('Logo', () => {
  it('default emits a 16px mark and 13px wordmark', async () => {
    const html = await renderToString(<Logo />)
    assert.match(html, /width:\s*16px/)
    assert.match(html, /height:\s*16px/)
    assert.match(html, /font-size:\s*13px/)
  })

  it('tall emits a 22px mark and 15px wordmark with a softer 6px corner', async () => {
    const html = await renderToString(<Logo tall />)
    assert.match(html, /width:\s*22px/)
    assert.match(html, /height:\s*22px/)
    assert.match(html, /font-size:\s*15px/)
    assert.match(html, /border-radius:\s*6px/)
  })
})
