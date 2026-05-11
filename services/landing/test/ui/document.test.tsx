import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Document } from '../../app/ui/document.tsx'

const STYLE_LINK_ORDER = [
  '/styles/utopia.css',
  '/styles/tokens.css',
  '/styles/global.css',
  '/styles/layout-primitives/stack.css',
  '/styles/blocks/layout.css',
  '/styles/blocks/focus-ring.css',
  '/styles/compositions/composer.css',
  '/styles/exceptions.css',
] as const

describe('Document', () => {
  it('emits stylesheet <link> tags in CUBE-canonical cascade order', async () => {
    const html = await renderToString(<Document title="x">hi</Document>)
    const indices = STYLE_LINK_ORDER.map((file) => {
      const idx = html.indexOf(`href="${file}"`)
      assert.notEqual(idx, -1, `expected ${file} <link>`)
      return idx
    })
    for (let i = 1; i < indices.length; i++) {
      assert.ok(
        indices[i - 1] < indices[i],
        `expected ${STYLE_LINK_ORDER[i - 1]} before ${STYLE_LINK_ORDER[i]}`,
      )
    }
  })

  it('loads focus-ring.css after every other block file so its :focus-visible composite wins', async () => {
    const html = await renderToString(<Document title="x">hi</Document>)
    const focusRing = html.indexOf('href="/styles/blocks/focus-ring.css"')
    const exceptions = html.indexOf('href="/styles/exceptions.css"')
    assert.ok(focusRing > 0)
    assert.ok(focusRing < exceptions, 'focus-ring must precede exceptions')
    // Every other blocks/*.css link should appear before focus-ring.
    const blocksRe = /href="\/styles\/blocks\/([^"]+)\.css"/g
    let m: RegExpExecArray | null
    while ((m = blocksRe.exec(html)) !== null) {
      if (m[1] === 'focus-ring') continue
      assert.ok(
        m.index < focusRing,
        `block file ${m[1]} should load before focus-ring`,
      )
    }
  })

  it('loads every compositions/*.css after the last blocks/*.css and before exceptions.css', async () => {
    // The OpenVoid composition tier (Composer, Cards, Connector, etc.)
    // assembles blocks. Loading after blocks lets a composition override
    // a block default without `!important`. Loading before exceptions
    // preserves the data-attribute variant layer's last-word.
    const html = await renderToString(<Document title="x">hi</Document>)
    const exceptions = html.indexOf('href="/styles/exceptions.css"')
    assert.ok(exceptions > 0, 'expected exceptions.css link')

    const blocksRe = /href="\/styles\/blocks\/([^"]+)\.css"/g
    let lastBlock = -1
    let bm: RegExpExecArray | null
    while ((bm = blocksRe.exec(html)) !== null) {
      lastBlock = bm.index
    }
    assert.ok(lastBlock > 0, 'expected at least one blocks/*.css link')

    const compsRe = /href="\/styles\/compositions\/([^"]+)\.css"/g
    let firstComp = -1
    let cm: RegExpExecArray | null
    while ((cm = compsRe.exec(html)) !== null) {
      if (firstComp === -1) firstComp = cm.index
      assert.ok(
        cm.index > lastBlock,
        `composition file ${cm[1]} must load after the last blocks/*.css`,
      )
      assert.ok(
        cm.index < exceptions,
        `composition file ${cm[1]} must load before exceptions.css`,
      )
    }
    assert.ok(firstComp > 0, 'expected at least one compositions/*.css link')
  })

  it('does not inline layout-primitive CSS — each primitive is a static <link>', async () => {
    const html = await renderToString(<Document title="x">hi</Document>)
    // No <style>...</style> block carrying primitive rules.
    assert.doesNotMatch(html, /<style[^>]*>[\s\S]*\.stack\s*\{/)
    assert.doesNotMatch(html, /<style[^>]*>[\s\S]*\.cluster\s*\{/)
  })

  it('loads every layout-primitives/*.css after global.css and before the first blocks/*.css', async () => {
    // The Every Layout primitives form the CUBE Composition layer
    // and must sit between global resets and the Block layer.
    const html = await renderToString(<Document title="x">hi</Document>)
    const global = html.indexOf('href="/styles/global.css"')
    assert.ok(global > 0, 'expected global.css link')

    const blocksRe = /href="\/styles\/blocks\/([^"]+)\.css"/g
    const firstBlockMatch = blocksRe.exec(html)
    assert.notEqual(firstBlockMatch, null, 'expected at least one blocks/*.css link')
    const firstBlock = firstBlockMatch!.index

    const primsRe = /href="\/styles\/layout-primitives\/([^"]+)\.css"/g
    let primCount = 0
    let pm: RegExpExecArray | null
    while ((pm = primsRe.exec(html)) !== null) {
      primCount += 1
      assert.ok(pm.index > global, `primitive ${pm[1]} must load after global.css`)
      assert.ok(pm.index < firstBlock, `primitive ${pm[1]} must load before blocks/*.css`)
    }
    assert.ok(primCount >= 1, 'expected at least one layout-primitives/*.css link')
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
