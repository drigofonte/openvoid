import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { View } from '../../app/utils/derive.ts'
import { gateOnIngressReadiness } from '../../app/utils/ingress.ts'

const SID = '01HABCDEF'

const READY_VIEW: View = {
  kind: 'ready',
  sessionId: SID,
  agentUrl: 'https://01habcdef.agent.example/',
  previewUrl: 'https://01habcdef.preview.example/',
}

function fakeFetch(
  responses: Record<string, Response | Error>,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const response = responses[url]
    if (!response) throw new Error(`unexpected fetch: ${url}`)
    if (response instanceof Error) throw response
    return response
  }) as typeof globalThis.fetch
}

describe('gateOnIngressReadiness', () => {
  it('keeps ready when both probes succeed', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new Response(null, { status: 200 }),
      [READY_VIEW.previewUrl]: new Response(null, { status: 200 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.deepEqual(result, READY_VIEW)
  })

  it('keeps ready when probes return 4xx (HEAD often unsupported, treat as reachable)', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new Response(null, { status: 401 }),
      [READY_VIEW.previewUrl]: new Response(null, { status: 405 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.equal(result.kind, 'ready')
  })

  it('downgrades to provisioning(running-pre-ingress) when agent probe fails', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new Response(null, { status: 503 }),
      [READY_VIEW.previewUrl]: new Response(null, { status: 200 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.deepEqual(result, {
      kind: 'provisioning',
      sessionId: SID,
      status: 'Running',
      pendingPhase: 'running-pre-ingress',
    })
  })

  it('downgrades when preview probe fails', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new Response(null, { status: 200 }),
      [READY_VIEW.previewUrl]: new Response(null, { status: 502 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.equal(result.kind, 'provisioning')
  })

  it('downgrades when a probe throws (network error)', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new TypeError('connection refused'),
      [READY_VIEW.previewUrl]: new Response(null, { status: 200 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.equal(result.kind, 'provisioning')
  })

  it('passes through non-ready views unchanged', async () => {
    const provisioning: View = {
      kind: 'provisioning',
      sessionId: SID,
      status: 'Pending',
      pendingPhase: 'pending',
    }
    const fetch = fakeFetch({}) // no fetches expected

    const result = await gateOnIngressReadiness(provisioning, { fetch })

    assert.deepEqual(result, provisioning)
  })

  it('honours the timeout (probe rejects on AbortSignal)', async (t) => {
    // Fake fetch that hangs forever unless aborted.
    const fetch: typeof globalThis.fetch = ((_, init?: RequestInit) =>
      new Promise((_, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })) as typeof globalThis.fetch

    const start = Date.now()
    const result = await gateOnIngressReadiness(READY_VIEW, { fetch, timeoutMs: 50 })
    const elapsed = Date.now() - start

    assert.equal(result.kind, 'provisioning')
    assert.ok(elapsed < 500, `probe should have timed out quickly; took ${elapsed}ms`)
    void t // keep TS happy on unused param
  })
})
