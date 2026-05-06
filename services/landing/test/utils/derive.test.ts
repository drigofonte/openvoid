import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { deriveView, type DeriveInput } from '../../app/utils/derive.ts'

const SID = '01HABCDEF'

function input(partial: Partial<DeriveInput> & Pick<DeriveInput, 'status'>): DeriveInput {
  return { sessionId: SID, ...partial }
}

describe('deriveView', () => {
  it('Pending → provisioning(pending)', () => {
    const view = deriveView(input({ status: 'Pending' }))
    assert.deepEqual(view, {
      kind: 'provisioning',
      sessionId: SID,
      status: 'Pending',
      pendingPhase: 'pending',
    })
  })

  it('Running with both URLs → ready', () => {
    const view = deriveView(
      input({
        status: 'Running',
        agentUrl: 'http://01habcdef.agent.example/',
        previewUrl: 'http://01habcdef.preview.example/',
      }),
    )
    assert.deepEqual(view, {
      kind: 'ready',
      sessionId: SID,
      agentUrl: 'http://01habcdef.agent.example/',
      previewUrl: 'http://01habcdef.preview.example/',
    })
  })

  it('Running without URLs stays provisioning (R3 status-gated URL contract)', () => {
    const view = deriveView(input({ status: 'Running' }))
    assert.deepEqual(view, {
      kind: 'provisioning',
      sessionId: SID,
      status: 'Running',
      pendingPhase: 'running-pre-ingress',
    })
  })

  it('Running with only agentUrl stays provisioning', () => {
    const view = deriveView(
      input({ status: 'Running', agentUrl: 'http://01habcdef.agent.example/' }),
    )
    assert.equal(view.kind, 'provisioning')
  })

  it('Running with only previewUrl stays provisioning', () => {
    const view = deriveView(
      input({ status: 'Running', previewUrl: 'http://01habcdef.preview.example/' }),
    )
    assert.equal(view.kind, 'provisioning')
  })

  it('Stopping → stopping', () => {
    const view = deriveView(input({ status: 'Stopping' }))
    assert.deepEqual(view, { kind: 'stopping', sessionId: SID })
  })

  it('Stopped → done', () => {
    const view = deriveView(input({ status: 'Stopped' }))
    assert.deepEqual(view, { kind: 'done', sessionId: SID })
  })

  it('Failed without reason → failed without reason', () => {
    const view = deriveView(input({ status: 'Failed' }))
    assert.deepEqual(view, { kind: 'failed', sessionId: SID, reason: undefined })
  })

  it('Failed with failureReason.message → failed with reason', () => {
    const view = deriveView(input({ status: 'Failed', failureReason: { message: 'image pull' } }))
    assert.deepEqual(view, { kind: 'failed', sessionId: SID, reason: 'image pull' })
  })

  it('throws on an unknown SessionPhase (protocol-drift guard)', () => {
    assert.throws(
      () => deriveView({ sessionId: SID, status: 'Restarting' as never }),
      /unknown SessionPhase: Restarting/,
    )
  })
})
