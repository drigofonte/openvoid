import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { View } from '../../app/utils/derive.ts'
import { gateOnIngressReadiness } from '../../app/utils/ingress.ts'

const SID = '01HABCDEF'

const READY_VIEW: View = {
  kind: 'ready',
  sessionId: SID,
  agentUrl: 'http://01habcdef.agent.example/',
  previewUrl: 'http://01habcdef.preview.example/',
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
  it('keeps ready when the agent probe succeeds', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new Response(null, { status: 200 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.deepEqual(result, READY_VIEW)
  })

  it('keeps ready when the agent returns 4xx (HEAD often unsupported, treat as reachable)', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new Response(null, { status: 401 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.equal(result.kind, 'ready')
  })

  it('does NOT probe the preview URL — preview readiness depends on the user starting a dev server', async () => {
    // Preview URL is intentionally not in the fakeFetch map. If the
    // gate probed it, fakeFetch would throw `unexpected fetch:` and
    // the test would fail. Asserting via "no fetch happened" rather
    // than mocking a 502 keeps the contract explicit.
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new Response(null, { status: 200 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.deepEqual(result, READY_VIEW)
  })

  it('downgrades to provisioning(running-pre-ingress) when agent probe returns 5xx', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new Response(null, { status: 503 }),
    })

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch })

    assert.deepEqual(result, {
      kind: 'provisioning',
      sessionId: SID,
      status: 'Running',
      pendingPhase: 'running-pre-ingress',
    })
  })

  it('downgrades when the agent probe throws (network error)', async () => {
    const fetch = fakeFetch({
      [READY_VIEW.agentUrl]: new TypeError('connection refused'),
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

  it('skips the probe entirely when skip=true (returns ready unchanged, no fetch)', async () => {
    // skip is the in-cluster escape hatch. fakeFetch with no entries
    // would throw on any fetch — the test passes only if skip prevents
    // the probe from firing.
    const fetch = fakeFetch({})

    const result = await gateOnIngressReadiness(READY_VIEW, { fetch, skip: true })

    assert.deepEqual(result, READY_VIEW)
  })

  it('honours the timeout (probe rejects on AbortSignal)', async () => {
    // Fake fetch that hangs forever unless aborted.
    const fetch: typeof globalThis.fetch = ((_, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      })) as typeof globalThis.fetch

    const start = Date.now()
    const result = await gateOnIngressReadiness(READY_VIEW, { fetch, timeoutMs: 50 })
    const elapsed = Date.now() - start

    assert.equal(result.kind, 'provisioning')
    assert.ok(elapsed < 500, `probe should have timed out quickly; took ${elapsed}ms`)
  })
})
