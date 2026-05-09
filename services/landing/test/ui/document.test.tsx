import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Document } from '../../app/ui/document.tsx'

const STYLE_LINK_ORDER = [
  'utopia.css',
  'tokens.css',
  'base.css',
  'composition.css',
  'blocks.css',
  'exceptions.css',
] as const

describe('Document', () => {
  it('emits six stylesheet <link> tags in CUBE-canonical cascade order', async () => {
    const html = await renderToString(<Document title="x">hi</Document>)
    const indices = STYLE_LINK_ORDER.map((file) => {
      const idx = html.indexOf(`href="/styles/${file}"`)
      assert.notEqual(idx, -1, `expected /styles/${file} <link>`)
      return idx
    })
    for (let i = 1; i < indices.length; i++) {
      assert.ok(
        indices[i - 1] < indices[i],
        `expected ${STYLE_LINK_ORDER[i - 1]} before ${STYLE_LINK_ORDER[i]}`,
      )
    }
  })

  it('does not inline composition CSS — composition.css is now a static <link>', async () => {
    const html = await renderToString(<Document title="x">hi</Document>)
    // No <style>...</style> block carrying composition rules.
    assert.doesNotMatch(html, /<style[^>]*>[\s\S]*\.stack\s*\{/)
    assert.doesNotMatch(html, /<style[^>]*>[\s\S]*\.cluster\s*\{/)
  })

  it('loads utopia.css before tokens.css so --fs-h1: var(--step-3) resolves', async () => {
    // Guards against a future cascade-order refactor inverting the
    // substrate dependencies (which would silently break every
    // Utopia-aliased token).
    const html = await renderToString(<Document title="x">hi</Document>)
    const utopia = html.indexOf('href="/styles/utopia.css"')
    const tokens = html.indexOf('href="/styles/tokens.css"')
    assert.ok(utopia >= 0 && tokens >= 0)
    assert.ok(utopia < tokens)
  })
})
