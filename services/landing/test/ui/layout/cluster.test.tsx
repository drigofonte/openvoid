import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Cluster } from '../../../app/ui/layout/cluster.tsx'

describe('Cluster', () => {
  it('renders <div class="cluster ..."> with children', async () => {
    const html = await renderToString(<Cluster>hello</Cluster>)
    assert.match(html, /class="cluster[^"]*"[^>]*>hello<\/div>/)
  })

  it('emits the supplied --space, --justify, --align as CSS custom properties', async () => {
    const html = await renderToString(
      <Cluster space="2rem" justify="center" align="end">x</Cluster>,
    )
    assert.match(html, /--space:\s*2rem/)
    assert.match(html, /--justify:\s*center/)
    assert.match(html, /--align:\s*end/)
  })

  it('emits the documented defaults when no overrides are passed', async () => {
    const html = await renderToString(<Cluster>x</Cluster>)
    assert.match(html, /--space:\s*var\(--space-s\)/)
    assert.match(html, /--justify:\s*flex-start/)
    assert.match(html, /--align:\s*center/)
  })

  it('passes through the id attribute', async () => {
    const html = await renderToString(<Cluster id="metadata-row">x</Cluster>)
    assert.match(html, /id="metadata-row"/)
  })
})
