import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { TopBar } from '../../app/ui/top-bar.tsx'

describe('TopBar', () => {
  describe('path mode', () => {
    it('renders a bare <header> (shape governed by .app-shell header) with the decorative slug', async () => {
      const html = await renderToString(
        <TopBar chrome={{ mode: 'path', path: '/sessions/abc' }} />,
      )
      // No chrome class — the App Shell composition styles the
      // <header> element via descendant rule.
      assert.match(html, /<header>/)
      assert.doesNotMatch(html, /class="wf-toolbar/)
      assert.match(html, /openvoid\.dev\/sessions\/abc/)
    })

    it('renders the maria/openvoid.dev placeholder when path is omitted', async () => {
      const html = await renderToString(<TopBar chrome={{ mode: 'path' }} />)
      assert.match(html, />maria<\//)
      assert.match(html, /openvoid\.dev/)
    })

    it('does not emit any breadcrumb here-segment span', async () => {
      const html = await renderToString(<TopBar chrome={{ mode: 'path', path: '/x' }} />)
      assert.doesNotMatch(html, /font-mono/i)
    })

    it('renders the right slot after the spacer', async () => {
      const html = await renderToString(
        <TopBar chrome={{ mode: 'path' }} right={<span data-tag="r" />} />,
      )
      const spacerIdx = html.indexOf('wf-spacer')
      const rightIdx = html.indexOf('data-tag="r"')
      assert.notEqual(spacerIdx, -1)
      assert.notEqual(rightIdx, -1)
      assert.ok(spacerIdx < rightIdx)
    })
  })

  describe('crumbs mode', () => {
    it('renders a bare <header> with the here segment in mono', async () => {
      const html = await renderToString(
        <TopBar chrome={{ mode: 'crumbs', here: '01HABCDE' }} />,
      )
      // No chrome class — shape comes from `.app-shell header`.
      assert.match(html, /<header>/)
      assert.doesNotMatch(html, /class="wf-toolbar/)
      assert.match(html, /font-family:\s*var\(--font-mono\)/)
      assert.match(html, />01HABCDE</)
    })

    it('omits the workspace segment when workspace is not provided', async () => {
      const html = await renderToString(
        <TopBar chrome={{ mode: 'crumbs', here: '01HABCDE' }} />,
      )
      // No leading <span class="wf-meta">workspace</span> nor the
      // adjacent slash separator.
      assert.doesNotMatch(html, /wf-meta wf-fg-muted/)
      assert.doesNotMatch(html, />\/</)
    })

    it('omits the workspace segment when workspace is the empty string', async () => {
      const html = await renderToString(
        <TopBar chrome={{ mode: 'crumbs', workspace: '', here: '01HABCDE' }} />,
      )
      assert.doesNotMatch(html, /wf-meta wf-fg-muted/)
    })

    it('renders both breadcrumb spans when workspace is present', async () => {
      const html = await renderToString(
        <TopBar chrome={{ mode: 'crumbs', workspace: 'maria', here: 'session' }} />,
      )
      assert.match(html, />maria</)
      assert.match(html, />\/</)
      assert.match(html, />session</)
    })

    it('renders the right slot after the spacer', async () => {
      const html = await renderToString(
        <TopBar chrome={{ mode: 'crumbs', here: 'x' }} right={<span data-tag="r" />} />,
      )
      const spacerIdx = html.indexOf('wf-spacer')
      const rightIdx = html.indexOf('data-tag="r"')
      assert.ok(spacerIdx < rightIdx)
    })
  })
})
