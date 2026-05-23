import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { signature } from '../../../../app/actions/sessions/client/status-poller.tsx'

const AGENT_URL = 'http://01habcdef.agent.example/'
const PREVIEW_URL = 'http://01habcdef.preview.example/'

describe('StatusPoller.signature', () => {
  it('U4: signature differs when agentSessionId arrives mid-poll', () => {
    const before = signature({
      kind: 'ready',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
    })
    const after = signature({
      kind: 'ready',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      agentSessionId: 'ses_x',
    })
    assert.notEqual(before, after)
  })

  it('U4: signature is stable when payload (incl. agentSessionId) is unchanged', () => {
    // SSR-ready view contract: if the initial-signature seed already
    // included agentSessionId, the first poll response with the same
    // payload must produce the same signature — no spurious navigate.
    const initial = [
      'ready',
      '', // initialPendingPhase
      AGENT_URL,
      PREVIEW_URL,
      'ses_x', // initialAgentSessionId
    ].join('|')
    const firstPoll = signature({
      kind: 'ready',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      agentSessionId: 'ses_x',
    })
    assert.equal(initial, firstPoll)
  })

  it('U4: signature for ready-without-id differs from ready-with-id', () => {
    // Defensive: confirm the empty-agentSessionId case (impossible
    // post-U4 derive, but the poller may still see legacy payloads
    // mid-deploy) sorts distinctly from a populated one.
    const noId = signature({
      kind: 'ready',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      agentSessionId: null,
    })
    const withId = signature({
      kind: 'ready',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      agentSessionId: 'ses_x',
    })
    assert.notEqual(noId, withId)
  })
})
