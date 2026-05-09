import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Switcher } from '../../../app/ui/layout/switcher.tsx'

describe('Switcher', () => {
  it('renders <div class="switcher switcher-N ..."> at the default limit and skips the per-instance <style>', async () => {
    const html = await renderToString(<Switcher>x</Switcher>)
    assert.match(html, /class="switcher switcher-\d+[^"]*"/)
    assert.doesNotMatch(html, /:nth-last-child/)
  })

  it('emits the documented defaults: --threshold: 30rem, --space: var(--space-s)', async () => {
    const html = await renderToString(<Switcher>x</Switcher>)
    assert.match(html, /--threshold:\s*30rem/)
    assert.match(html, /--space:\s*var\(--space-s\)/)
  })

  it('emits a sibling <style> with the right :nth-last-child rule when limit differs from the default', async () => {
    const html = await renderToString(<Switcher limit={2}>x</Switcher>)
    const limitMatch = html.match(/<style>\.switcher-(\d+) > :nth-last-child\(n\+3\)[^<]*<\/style>/)
    assert.ok(limitMatch, 'expected an inline <style> with :nth-last-child(n+3) for limit=2')
    const id = limitMatch![1]
    assert.match(html, new RegExp(`class="switcher switcher-${id}[^"]*"`))
    assert.match(html, /flex-basis:\s*100%/)
  })

  it('produces well-formed rules at edge limit values', async () => {
    const htmlOne = await renderToString(<Switcher limit={1}>x</Switcher>)
    assert.match(htmlOne, /:nth-last-child\(n\+2\)/)

    const htmlZero = await renderToString(<Switcher limit={0}>x</Switcher>)
    assert.match(htmlZero, /:nth-last-child\(n\+1\)/)
  })

  it('gives sibling Switcher instances distinct scoped IDs in the same render', async () => {
    const html = await renderToString(
      <div>
        <Switcher limit={2}>a</Switcher>
        <Switcher limit={3}>b</Switcher>
      </div>,
    )
    const ids = [...html.matchAll(/class="switcher switcher-(\d+)/g)].map((m) => m[1])
    assert.equal(ids.length, 2, 'expected two switcher instances')
    assert.notEqual(ids[0], ids[1], 'expected distinct switcher IDs')
    assert.match(html, new RegExp(`<style>\\.switcher-${ids[0]} > :nth-last-child\\(n\\+3\\)`))
    assert.match(html, new RegExp(`<style>\\.switcher-${ids[1]} > :nth-last-child\\(n\\+4\\)`))
  })
})
