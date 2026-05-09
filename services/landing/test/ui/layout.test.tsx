import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { Layout } from '../../app/ui/layout.tsx'

describe('Layout', () => {
  it('narrow (default) renders main inside a 960px max-width column', async () => {
    const html = await renderToString(
      <Layout topBarChrome={{ mode: 'path', path: '/' }}>x</Layout>,
    )
    // The Remix `mix={css({...})}` machinery emits the rule inside
    // a <style data-rmx="..."> block; the <main> tag carries the
    // generated class name. Pin the rule by its declaration text.
    assert.match(html, /max-width:\s*960px/)
    assert.match(html, /padding:\s*40px 24px 48px/)
  })

  it('full renders main with width 100% (no max-width, no padding)', async () => {
    const html = await renderToString(
      <Layout topBarChrome={{ mode: 'path', path: '/' }} mainKind="full">x</Layout>,
    )
    // The full-mode <main> only declares `width: 100%`; the
    // narrow-mode rule (max-width 960px + padding) must not be
    // emitted on this render.
    assert.match(html, /<main\b[^>]*>/)
    assert.match(html, /width:\s*100%/)
    assert.doesNotMatch(html, /max-width:\s*960px/)
    assert.doesNotMatch(html, /padding:\s*40px 24px 48px/)
  })

  it('passes topBarChrome through to TopBar (crumbs mode)', async () => {
    const html = await renderToString(
      <Layout topBarChrome={{ mode: 'crumbs', here: '01HABCDE' }}>x</Layout>,
    )
    assert.match(html, /class="wf-toolbar wf-toolbar-tall"/)
    assert.match(html, />01HABCDE</)
  })

  it('passes topBarRight to the TopBar right slot', async () => {
    const html = await renderToString(
      <Layout topBarChrome={{ mode: 'path' }} topBarRight={<span data-tag="r" />}>
        x
      </Layout>,
    )
    assert.match(html, /data-tag="r"/)
  })
})
