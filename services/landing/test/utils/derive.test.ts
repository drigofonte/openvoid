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
      pendingPhase: 'provisioning',
      activeStep: 0,
      sessionCreatedAt: undefined,
    })
  })

  it('Pending → provisioning carries sessionCreatedAt through', () => {
    const view = deriveView(input({ status: 'Pending', createdAt: '2026-05-12T00:00:00.000Z' }))
    assert.deepEqual(view, {
      kind: 'provisioning',
      sessionId: SID,
      status: 'Pending',
      pendingPhase: 'provisioning',
      activeStep: 0,
      sessionCreatedAt: '2026-05-12T00:00:00.000Z',
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
      activeStep: 4,
      sessionCreatedAt: undefined,
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

  // U9: server now sends a real pendingPhase discriminator (per
  // packages/protocol/main.tsp) plus a SessionError on Failed.
  // derive.ts plumbs both through and contributes the activeStep
  // integer the storyboard reads.

  it('U9: server pendingPhase=seeding-scaffold → view.activeStep=1', () => {
    const view = deriveView(input({ status: 'Pending', pendingPhase: 'seeding-scaffold' }))
    assert.equal(view.kind, 'provisioning')
    if (view.kind !== 'provisioning') return
    assert.equal(view.pendingPhase, 'seeding-scaffold')
    assert.equal(view.activeStep, 1)
  })

  it('U9: server pendingPhase=installing-deps → view.activeStep=2', () => {
    const view = deriveView(input({ status: 'Pending', pendingPhase: 'installing-deps' }))
    assert.equal(view.kind, 'provisioning')
    if (view.kind !== 'provisioning') return
    assert.equal(view.pendingPhase, 'installing-deps')
    assert.equal(view.activeStep, 2)
  })

  it('U9: server pendingPhase=awaiting-dev-server → view.activeStep=3', () => {
    const view = deriveView(input({ status: 'Pending', pendingPhase: 'awaiting-dev-server' }))
    assert.equal(view.kind, 'provisioning')
    if (view.kind !== 'provisioning') return
    assert.equal(view.pendingPhase, 'awaiting-dev-server')
    assert.equal(view.activeStep, 3)
  })

  it('U9: server pendingPhase=running-pre-ingress on Pending → view.activeStep=4', () => {
    // Server can emit running-pre-ingress directly (when phase reads
    // Pending mid-ingress-programming) — landing should plumb it
    // verbatim rather than synthesize a different value.
    const view = deriveView(input({ status: 'Pending', pendingPhase: 'running-pre-ingress' }))
    assert.equal(view.kind, 'provisioning')
    if (view.kind !== 'provisioning') return
    assert.equal(view.pendingPhase, 'running-pre-ingress')
    assert.equal(view.activeStep, 4)
  })

  it('U9: Pending without pendingPhase falls back to provisioning(step 0) for pre-U9 server responses', () => {
    const view = deriveView(input({ status: 'Pending' }))
    assert.equal(view.kind, 'provisioning')
    if (view.kind !== 'provisioning') return
    assert.equal(view.pendingPhase, 'provisioning')
    assert.equal(view.activeStep, 0)
  })

  it('U9: Failed with session.error.message → failed view carries the error message as reason', () => {
    const view = deriveView(
      input({
        status: 'Failed',
        error: { code: 'init_failed', message: 'workspace-init Error (exit 128): git push rejected' },
      }),
    )
    assert.deepEqual(view, {
      kind: 'failed',
      sessionId: SID,
      reason: 'workspace-init Error (exit 128): git push rejected',
    })
  })

  it('U9: Failed prefers session.error.message over the legacy failureReason.message', () => {
    const view = deriveView(
      input({
        status: 'Failed',
        error: { code: 'agent_crashloop', message: 'agent crashlooped' },
        failureReason: { message: 'legacy fallback' },
      }),
    )
    if (view.kind !== 'failed') return assert.fail('expected failed view')
    assert.equal(view.reason, 'agent crashlooped')
  })
})
