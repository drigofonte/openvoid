import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Document } from '../../app/ui/document.tsx'

describe('Document', () => {
  it('inlines composition.css into <head> as a <style> block with key class definitions', async () => {
    const html = await renderToString(<Document title="x">hi</Document>)
    assert.match(html, /<style>[\s\S]*\.stack\s*\{[\s\S]*<\/style>/)
    assert.match(html, /\.cluster\s*\{/)
    assert.match(html, /\.cover-centered\s*\{/)
    assert.match(html, /\.switcher\s*\{/)
    assert.match(html, /\.frame\s*\{/)
  })

  it('preserves `>` child combinators in the inlined CSS (no &gt; escape inside <style>)', async () => {
    const html = await renderToString(<Document title="x">hi</Document>)
    // `<style>` is a raw-text element; browsers do not decode HTML
    // entities in its content, so an escaped `&gt;` would break every
    // direct-child selector in composition.css (`.stack > *`,
    // `.cover > :first-child`, etc.).
    assert.match(html, /\.stack\s*>\s*\*/)
    assert.match(html, /\.cover\s*>\s*:first-child/)
    assert.doesNotMatch(html, /\.stack\s*&gt;/)
  })

  it('emits the inline <style> after the theme.css <link> so composition rules win on cascade ties', async () => {
    const html = await renderToString(<Document title="x">hi</Document>)
    const themeLinkIdx = html.indexOf('href="/styles/theme.css"')
    const styleIdx = html.indexOf('<style>')
    assert.notEqual(themeLinkIdx, -1)
    assert.notEqual(styleIdx, -1)
    assert.ok(styleIdx > themeLinkIdx, 'expected <style> to appear after theme.css <link>')
  })
})
