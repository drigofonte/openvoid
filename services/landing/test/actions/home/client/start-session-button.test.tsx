import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { StartSessionButton } from '../../../../app/actions/home/client/start-session-button.tsx'

describe('StartSessionButton (SSR fallback)', () => {
  it('renders <button class="wf-btn-go" type="submit"> with the default label and arrow SVG', async () => {
    const html = await renderToString(<StartSessionButton targetId="prompt" />)
    assert.match(html, /<button\b[^>]*\btype="submit"[^>]*>/)
    assert.match(html, /<button\b[^>]*\bclass="[^"]*\bwf-btn-go\b[^"]*"[^>]*>/)
    assert.match(html, />Start session</)
    // Arrow SVG sits inside the button
    assert.match(html, /M5 12h14M13 5l7 7-7 7/)
  })

  it('does not emit kbd glyphs inside the button — kbd lives in the sibling submit-area', async () => {
    const html = await renderToString(<StartSessionButton targetId="prompt" />)
    // No <kbd> children, no .wf-keycap inside
    assert.doesNotMatch(html, /<button[^>]*>[\s\S]*<kbd/)
    assert.doesNotMatch(html, /<button[^>]*>[\s\S]*wf-keycap/)
  })

  it('SSR fallback ships the button enabled — no-JS users can submit', async () => {
    const html = await renderToString(<StartSessionButton targetId="prompt" />)
    // No `disabled` attribute on the button at SSR time. Hydration
    // adds the disable-until-prompt-≥8-chars gate.
    assert.doesNotMatch(html, /<button\b[^>]*\bdisabled\b[^>]*>/)
  })

  it('renders a custom label when provided', async () => {
    const html = await renderToString(
      <StartSessionButton targetId="prompt" label="Continue session" />,
    )
    assert.match(html, />Continue session</)
  })
})
