import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'
// Import Frame from remix/ui alongside our AspectFrame to prove the
// rename eliminated the import-time identifier collision. If both
// names co-exist in scope without a TS error, the rename held.
import { Frame as _RemixFrame } from 'remix/ui'

import { AspectFrame } from '../../../app/ui/layout/aspect-frame.tsx'

void _RemixFrame

describe('AspectFrame', () => {
  it('renders <div class="frame ..."> with children', async () => {
    const html = await renderToString(<AspectFrame>media</AspectFrame>)
    assert.match(html, /class="frame[^"]*"[^>]*>media<\/div>/)
  })

  it('emits the default --ratio: 16 / 9', async () => {
    const html = await renderToString(<AspectFrame>x</AspectFrame>)
    assert.match(html, /--ratio:\s*16\s*\/\s*9/)
  })

  it('emits explicit ratio overrides', async () => {
    const html = await renderToString(<AspectFrame ratio="1 / 1">x</AspectFrame>)
    assert.match(html, /--ratio:\s*1\s*\/\s*1/)
  })
})
