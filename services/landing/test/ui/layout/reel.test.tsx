import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Reel } from '../../../app/ui/layout/reel.tsx'

describe('Reel', () => {
  it('renders <div class="reel ..."> with children, no reel-no-bar by default', async () => {
    const html = await renderToString(<Reel>items</Reel>)
    assert.match(html, /class="reel[^"]*"[^>]*>items<\/div>/)
    assert.doesNotMatch(html, /reel-no-bar/)
  })

  it('adds reel-no-bar when noBar is true', async () => {
    const html = await renderToString(<Reel noBar>items</Reel>)
    assert.match(html, /class="reel reel-no-bar[^"]*"/)
  })

  it('emits the documented defaults: --item-width: auto, --space: var(--space-s), --reel-height: auto', async () => {
    const html = await renderToString(<Reel>x</Reel>)
    assert.match(html, /--item-width:\s*auto/)
    assert.match(html, /--space:\s*var\(--space-s\)/)
    assert.match(html, /--reel-height:\s*auto/)
  })

  it('emits explicit overrides for itemWidth, space, height', async () => {
    const html = await renderToString(
      <Reel itemWidth="240px" space="0.5rem" height="320px">x</Reel>,
    )
    assert.match(html, /--item-width:\s*240px/)
    assert.match(html, /--space:\s*0\.5rem/)
    assert.match(html, /--reel-height:\s*320px/)
  })
})
