import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Stack } from '../../../app/ui/layout/stack.tsx'

describe('Stack', () => {
  it('renders <div class="stack ..."> with children in order', async () => {
    const html = await renderToString(
      <Stack>
        <p>a</p>
        <p>b</p>
        <p>c</p>
      </Stack>,
    )
    assert.match(html, /class="stack[^"]*"/)
    assert.match(html, /<p>a<\/p>\s*<p>b<\/p>\s*<p>c<\/p>/)
  })

  it('emits the supplied --space', async () => {
    const html = await renderToString(<Stack space="1.5rem">x</Stack>)
    assert.match(html, /--space:\s*1\.5rem/)
  })

  it('emits the documented default --space: var(--space-s)', async () => {
    const html = await renderToString(<Stack>x</Stack>)
    assert.match(html, /--space:\s*var\(--space-s\)/)
  })

  it('adds stack-recursive when recursive is true', async () => {
    const html = await renderToString(<Stack recursive>x</Stack>)
    assert.match(html, /class="stack stack-recursive[^"]*"/)
  })

  it('preserves the consumer-tagged stack-split class on a child', async () => {
    const html = await renderToString(
      <Stack>
        <header>top</header>
        <div class="stack-split">middle</div>
        <footer>bottom</footer>
      </Stack>,
    )
    assert.match(html, /<div class="stack-split">middle<\/div>/)
    assert.match(html, /<header>top<\/header>/)
    assert.match(html, /<footer>bottom<\/footer>/)
  })
})
