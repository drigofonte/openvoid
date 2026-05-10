import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Connector } from '../../app/ui/connector.tsx'

describe('Connector', () => {
  it('emits a wf-connector wrapper marked aria-hidden', async () => {
    const html = await renderToString(<Connector />)
    assert.match(html, /<div\b[^>]*\bclass="wf-connector"[^>]*>/)
    assert.match(html, /<div\b[^>]*\baria-hidden="true"[^>]*>/)
  })

  it('emits the SVG with kebab-case viewBox + preserveAspectRatio attributes', async () => {
    const html = await renderToString(<Connector />)
    // Remix 3 lowercases unrecognized JSX attribute names; the
    // SVG must be authored with the kebab-case spellings the
    // browser actually consumes.
    assert.match(html, /viewBox="0 0 120 60"/)
    assert.match(html, /preserveAspectRatio="none"/)
  })

  it('emits the wf-connector-flow class on the dashed flow path', async () => {
    const html = await renderToString(<Connector />)
    assert.match(html, /class="wf-connector-flow"/)
  })

  it('emits an arrowhead path stroked in the accent token', async () => {
    const html = await renderToString(<Connector />)
    assert.match(html, /M 109 25 L 116 30 L 109 35/)
    assert.match(html, /stroke="var\(--accent\)"/)
  })
})
