import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { isTerminal, pollCadenceMs } from '../../app/utils/poll.ts'

describe('pollCadenceMs', () => {
  it('returns 1000 ms while elapsed < 30s', () => {
    assert.equal(pollCadenceMs(0), 1000)
    assert.equal(pollCadenceMs(1), 1000)
    assert.equal(pollCadenceMs(29_999), 1000)
  })

  it('returns 5000 ms between 30s and 90s', () => {
    assert.equal(pollCadenceMs(30_000), 5000)
    assert.equal(pollCadenceMs(60_000), 5000)
    assert.equal(pollCadenceMs(89_999), 5000)
  })

  it('returns 10000 ms once elapsed >= 90s', () => {
    assert.equal(pollCadenceMs(90_000), 10_000)
    assert.equal(pollCadenceMs(91_000), 10_000)
    assert.equal(pollCadenceMs(600_000), 10_000)
  })
})

describe('isTerminal', () => {
  it('treats provisioning + stopping as non-terminal', () => {
    assert.equal(isTerminal({ kind: 'provisioning', sessionId: 'x', status: 'Pending' }), false)
    assert.equal(isTerminal({ kind: 'stopping', sessionId: 'x' }), false)
  })

  it('treats ready + done + failed as terminal', () => {
    assert.equal(
      isTerminal({ kind: 'ready', sessionId: 'x', agentUrl: 'http://a', previewUrl: 'http://p' }),
      true,
    )
    assert.equal(isTerminal({ kind: 'done', sessionId: 'x' }), true)
    assert.equal(isTerminal({ kind: 'failed', sessionId: 'x' }), true)
  })

  it('is idempotent (calling twice returns the same value)', () => {
    const view = { kind: 'done' as const, sessionId: 'x' }
    assert.equal(isTerminal(view), true)
    assert.equal(isTerminal(view), true)
  })
})
