import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Card } from '../../app/ui/card.tsx'

describe('Card', () => {
  it('default variant renders <div class="wf-card">', async () => {
    const html = await renderToString(<Card>x</Card>)
    assert.match(html, /<div class="wf-card">x<\/div>/)
  })

  it('elevated variant renders <div class="wf-card-elev">', async () => {
    const html = await renderToString(<Card variant="elevated">x</Card>)
    assert.match(html, /<div class="wf-card-elev">x<\/div>/)
  })

  it('elevated + accentTop emits the data-accent-top attribute', async () => {
    const html = await renderToString(
      <Card variant="elevated" accentTop>
        x
      </Card>,
    )
    assert.match(html, /<div\b[^>]*\bclass="wf-card-elev"[^>]*>x<\/div>/)
    assert.match(html, /<div\b[^>]*\bdata-accent-top="?"?[^>]*>x<\/div>/)
  })

  it('accentTop without elevated is a no-op (line cards stay clean)', async () => {
    const html = await renderToString(<Card accentTop>x</Card>)
    assert.match(html, /<div class="wf-card">x<\/div>/)
    assert.doesNotMatch(html, /data-accent-top/)
  })

  it('padding prop emits a mix-generated class with the supplied padding', async () => {
    const html = await renderToString(<Card padding="20px">x</Card>)
    assert.match(html, /padding:\s*20px/)
  })
})
