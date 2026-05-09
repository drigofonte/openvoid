import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Cover } from '../../../app/ui/layout/cover.tsx'

describe('Cover', () => {
  it('renders <div class="cover ..."> wrapping centered content in .cover-centered', async () => {
    const html = await renderToString(
      <Cover centered={<h1>Hi</h1>}>extra</Cover>,
    )
    assert.match(html, /<div class="cover[^"]*"[^>]*>/)
    assert.match(html, /<div class="cover-centered"><h1>Hi<\/h1><\/div>/)
    assert.match(html, /<\/div>extra<\/div>$/)
  })

  it('emits the documented defaults: --min-height: 100vh, --space and --padding: var(--space-m)', async () => {
    const html = await renderToString(<Cover centered={<h1>Hi</h1>} />)
    assert.match(html, /--min-height:\s*100vh/)
    assert.match(html, /--space:\s*var\(--space-m\)/)
    assert.match(html, /--padding:\s*var\(--space-m\)/)
  })

  it('emits --padding: 0 when noPad is true', async () => {
    const html = await renderToString(<Cover noPad centered={<h1>Hi</h1>} />)
    assert.match(html, /--padding:\s*0/)
  })

  it('emits explicit minHeight and space overrides', async () => {
    const html = await renderToString(
      <Cover minHeight="80vh" space="3rem" centered={<h1>Hi</h1>} />,
    )
    assert.match(html, /--min-height:\s*80vh/)
    assert.match(html, /--space:\s*3rem/)
    assert.match(html, /--padding:\s*3rem/)
  })

  it('renders only the centered slot when no children are provided', async () => {
    const html = await renderToString(<Cover centered={<h1>Hi</h1>} />)
    assert.match(html, /<div class="cover-centered"><h1>Hi<\/h1><\/div><\/div>/)
  })
})
