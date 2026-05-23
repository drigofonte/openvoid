import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  AGENT_PROJECT_PATH_B64,
  agentDeepLinkUrl,
} from '../../app/utils/agent-url.ts'

describe('agentDeepLinkUrl', () => {
  it('composes the deep-link URL for an agentUrl with a trailing slash', () => {
    assert.equal(
      agentDeepLinkUrl('http://abc.agent.example/', 'ses_xyz'),
      'http://abc.agent.example/L3dvcmtzcGFjZS9yZXBv/session/ses_xyz',
    )
  })

  it('composes the deep-link URL for an agentUrl without a trailing slash', () => {
    assert.equal(
      agentDeepLinkUrl('http://abc.agent.example', 'ses_xyz'),
      'http://abc.agent.example/L3dvcmtzcGFjZS9yZXBv/session/ses_xyz',
    )
  })

  it('produces exactly one slash before the encoded path segment when input has a trailing slash', () => {
    const url = agentDeepLinkUrl('http://abc.agent.example/', 'ses_xyz')
    assert.doesNotMatch(url, /\/\/L3dvcmtzcGFjZS9yZXBv/)
    assert.match(url, /example\/L3dvcmtzcGFjZS9yZXBv/)
  })
})

describe('AGENT_PROJECT_PATH_B64', () => {
  it('decodes to /workspace/repo (lockstep with Dockerfile WORKDIR)', () => {
    assert.equal(
      Buffer.from(AGENT_PROJECT_PATH_B64, 'base64').toString('utf8'),
      '/workspace/repo',
    )
  })
})
