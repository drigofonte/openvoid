import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Sidebar } from '../../../app/ui/layout/sidebar.tsx'

describe('Sidebar', () => {
  it('renders <div class="sidebar ..."> by default (no sidebar-right)', async () => {
    const html = await renderToString(<Sidebar>x</Sidebar>)
    assert.match(html, /class="sidebar[^"]*"/)
    assert.doesNotMatch(html, /sidebar-right/)
  })

  it('adds sidebar-right when side="right"', async () => {
    const html = await renderToString(<Sidebar side="right">x</Sidebar>)
    assert.match(html, /class="sidebar sidebar-right[^"]*"/)
  })

  it('emits the documented defaults: --side-width: 20rem, --content-min: 50%, --space: var(--space-l)', async () => {
    const html = await renderToString(<Sidebar>x</Sidebar>)
    assert.match(html, /--side-width:\s*20rem/)
    assert.match(html, /--content-min:\s*50%/)
    assert.match(html, /--space:\s*var\(--space-l\)/)
  })

  it('emits explicit overrides for sideWidth, contentMin, space', async () => {
    const html = await renderToString(
      <Sidebar sideWidth="14rem" contentMin="60%" space="1rem">x</Sidebar>,
    )
    assert.match(html, /--side-width:\s*14rem/)
    assert.match(html, /--content-min:\s*60%/)
    assert.match(html, /--space:\s*1rem/)
  })
})
