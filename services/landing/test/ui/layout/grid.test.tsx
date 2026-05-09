import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Grid } from '../../../app/ui/layout/grid.tsx'

describe('Grid', () => {
  it('renders <div class="grid ..."> with children', async () => {
    const html = await renderToString(<Grid>cells</Grid>)
    assert.match(html, /class="grid[^"]*"[^>]*>cells<\/div>/)
  })

  it('emits the documented defaults: --grid-min: 250px, --space: var(--space-m)', async () => {
    const html = await renderToString(<Grid>x</Grid>)
    assert.match(html, /--grid-min:\s*250px/)
    assert.match(html, /--space:\s*var\(--space-m\)/)
  })

  it('emits explicit overrides for --grid-min and --space', async () => {
    const html = await renderToString(<Grid min="180px" space="1rem">x</Grid>)
    assert.match(html, /--grid-min:\s*180px/)
    assert.match(html, /--space:\s*1rem/)
  })
})
