import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { UrlRow } from '../../app/ui/url-row.tsx'

describe('UrlRow', () => {
  it('splits scheme from rest on ://', async () => {
    const html = await renderToString(<UrlRow url="https://example.com/path" />)
    assert.match(html, /<span class="wf-url-scheme">https:\/\/<\/span>/)
    assert.match(html, /<span class="wf-url-rest">example\.com\/path<\/span>/)
  })

  it('renders the trail slot when children are provided', async () => {
    const html = await renderToString(
      <UrlRow url="https://x">
        <span data-tag="copy" />
      </UrlRow>,
    )
    assert.match(html, /<span class="wf-url-trail">/)
    assert.match(html, /data-tag="copy"/)
  })

  it('omits the trail slot when no children are provided', async () => {
    const html = await renderToString(<UrlRow url="https://x" />)
    assert.doesNotMatch(html, /wf-url-trail/)
  })

  it('renders the full string in the rest slot when scheme is absent', async () => {
    const html = await renderToString(<UrlRow url="example.com/path" />)
    assert.doesNotMatch(html, /wf-url-scheme/)
    assert.match(html, /<span class="wf-url-rest">example\.com\/path<\/span>/)
  })

  it('handles an empty url without crashing', async () => {
    const html = await renderToString(<UrlRow url="" />)
    assert.doesNotMatch(html, /wf-url-scheme/)
    assert.match(html, /<span class="wf-url-rest"><\/span>/)
  })

  it('preserves mixed-case schemes verbatim in the scheme slot', async () => {
    const html = await renderToString(<UrlRow url="HTTPS://example.com" />)
    assert.match(html, /<span class="wf-url-scheme">HTTPS:\/\/<\/span>/)
  })

  it('wraps the row in <div class="wf-url-row">', async () => {
    const html = await renderToString(<UrlRow url="https://x" />)
    assert.match(html, /^<div class="wf-url-row">/)
  })
})
