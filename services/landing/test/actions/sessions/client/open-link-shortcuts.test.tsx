import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { OpenLinkShortcuts } from '../../../../app/actions/sessions/client/open-link-shortcuts.tsx'

describe('OpenLinkShortcuts (SSR fallback)', () => {
  it('renders nothing visible — the shortcut is a hydration-only enhancement', async () => {
    const html = await renderToString(
      <OpenLinkShortcuts chatHref="https://chat" previewHref="https://preview" />,
    )
    // No <button>, no <a>, no visible UI. The clientEntry returns
    // `null` so the only rendered output is the framework's
    // hydration marker comment.
    assert.doesNotMatch(html, /<button\b/)
    assert.doesNotMatch(html, /<a\b/)
  })
})
