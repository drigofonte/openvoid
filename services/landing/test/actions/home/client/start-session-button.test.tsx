import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { StartSessionButton } from '../../../../app/actions/home/client/start-session-button.tsx'

describe('StartSessionButton (SSR fallback)', () => {
  it('renders <button class="btn-pri" type="submit"> with the default label and arrow SVG', async () => {
    const html = await renderToString(<StartSessionButton targetId="prompt" />)
    assert.match(html, /<button\b[^>]*\btype="submit"[^>]*>/)
    assert.match(html, /<button\b[^>]*\bclass="[^"]*\bbtn-pri\b[^"]*"[^>]*>/)
    assert.match(html, />Start session</)
    // Arrow SVG sits inside the button
    assert.match(html, /M5 12h14M13 5l7 7-7 7/)
  })

  it('does not emit kbd glyphs inside the button — kbd lives in the sibling submit-area', async () => {
    const html = await renderToString(<StartSessionButton targetId="prompt" />)
    // No <kbd> children, no keycap inside
    assert.doesNotMatch(html, /<button[^>]*>[\s\S]*<kbd/)
    assert.doesNotMatch(html, /<button[^>]*>[\s\S]*wf-keycap/)
  })

  it('SSR with no initialPrompt ships the button disabled — matches the hydrated state to avoid a black-to-grey flash', async () => {
    const html = await renderToString(<StartSessionButton targetId="prompt" />)
    // SSR's disabled state is computed from initialPrompt length so
    // first paint matches what hydration would render — no flash.
    // No-JS users can't submit a too-short prompt anyway; the
    // server-side CreateSchema validates length.
    assert.match(html, /<button\b[^>]*\bdisabled\b[^>]*>/)
  })

  it('SSR with a long-enough initialPrompt ships the button enabled', async () => {
    const html = await renderToString(
      <StartSessionButton targetId="prompt" initialPrompt="A weekend planner that pulls events" />,
    )
    // After a controller validation re-render with a substantial
    // previousValues.prompt, the button should be enabled on first
    // paint (the user already typed enough).
    assert.doesNotMatch(html, /<button\b[^>]*\bdisabled\b[^>]*>/)
  })

  it('renders a custom label when provided', async () => {
    const html = await renderToString(
      <StartSessionButton targetId="prompt" label="Continue session" />,
    )
    assert.match(html, />Continue session</)
  })
})
