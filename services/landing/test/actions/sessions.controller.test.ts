import type { components } from '@openvoid/protocol'
import * as assert from 'remix/assert'
import { afterEach, beforeEach, describe, it } from 'remix/test'

import { setApiBase } from '../../app/utils/api.ts'
import { createLandingRouter } from '../../app/router.ts'

const BASE = 'http://session-api.test'
const ORIGIN = 'http://localhost'
const SID = '01HABCDEF'

const AGENT_URL = 'https://01habcdef.agent.example/'
const PREVIEW_URL = 'https://01habcdef.preview.example/'

type SessionShape = Partial<components['schemas']['Session']> & {
  sessionId: string
  status: components['schemas']['SessionPhase']
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

/**
 * Fake fetch that:
 * - serves Session API requests (`${BASE}/sessions/...`) from the
 *   provided session-api responses queue.
 * - replies 200 to ingress-readiness HEAD probes against agent /
 *   preview URLs by default (override via `ingressOk: false`).
 */
function makeFetchMock(opts: {
  apiResponses: Array<Response | (() => Response | Promise<Response>)>
  ingressOk?: boolean
}): typeof globalThis.fetch {
  const queue = [...opts.apiResponses]
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.startsWith(BASE)) {
      const next = queue.shift()
      if (!next) throw new Error(`unexpected api fetch: ${url}`)
      return typeof next === 'function' ? next() : next
    }
    if (init?.method === 'HEAD') {
      // ingress probe
      return new Response(null, { status: opts.ingressOk === false ? 503 : 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof globalThis.fetch
}

beforeEach(() => {
  setApiBase(BASE)
})

afterEach(() => {
  setApiBase(undefined)
})

describe('GET /sessions/:id', () => {
  it('renders Provisioning for a Pending session', async (t) => {
    const session: SessionShape = { sessionId: SID, status: 'Pending' }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /Spinning up your session/)
    assert.match(html, /Cancel/)
  })

  it('renders Ready when status=Running, both URLs present, ingress probe succeeds', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
    }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    const html = await response.text()
    assert.match(html, /Your session is live/)
    assert.match(html, new RegExp(AGENT_URL.replace(/[/.]/g, '\\$&')))
    assert.match(html, new RegExp(PREVIEW_URL.replace(/[/.]/g, '\\$&')))
    assert.match(html, /Stop &amp; save/)
  })

  it('downgrades Ready→Provisioning when ingress probe fails', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
    }
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({ apiResponses: [jsonResponse(session)], ingressOk: false }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    const html = await response.text()
    assert.match(html, /Spinning up your session|programming routes/i)
    assert.doesNotMatch(html, /Your session is live/)
  })

  it('renders KillConfirm when ?confirm=stop is present and view is Ready', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
    }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(
      new Request(`${ORIGIN}/sessions/${SID}?confirm=stop`),
    )

    const html = await response.text()
    assert.match(html, /Save your work and shut down\?/)
    assert.match(html, /Yes, stop &amp; save/)
  })

  it('ignores ?confirm=stop when view is not Ready', async (t) => {
    const session: SessionShape = { sessionId: SID, status: 'Pending' }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(
      new Request(`${ORIGIN}/sessions/${SID}?confirm=stop`),
    )

    const html = await response.text()
    assert.match(html, /Spinning up your session/)
    assert.doesNotMatch(html, /Save your work and shut down\?/)
  })

  it('renders Failed for status=Failed', async (t) => {
    const session: SessionShape = { sessionId: SID, status: 'Failed' }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    const html = await response.text()
    assert.match(html, /Couldn't bring up the session/)
  })

  it('renders Done for status=Stopped', async (t) => {
    const session: SessionShape = { sessionId: SID, status: 'Stopped' }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    const html = await response.text()
    assert.match(html, /This session has been stopped/)
  })

  it('retries on 404 (read-after-write window) and renders normally on the second attempt', async (t) => {
    const session: SessionShape = { sessionId: SID, status: 'Pending' }
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({
        apiResponses: [
          jsonResponse({ code: 'not_found', message: 'gone' }, { status: 404 }),
          jsonResponse(session),
        ],
      }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /Spinning up your session/)
  })

  it('renders NotFound with status 404 after exhausting retries', async (t) => {
    const notFound = jsonResponse({ code: 'not_found', message: 'gone' }, { status: 404 })
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({ apiResponses: [notFound, notFound, notFound] }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    assert.equal(response.status, 404)
    const html = await response.text()
    assert.match(html, /No session with that ID/)
  })
})

describe('POST /sessions/:id (intent=stop)', () => {
  function postIntent(intent: string): Request {
    return new Request(`${ORIGIN}/sessions/${SID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ intent }).toString(),
    })
  }

  it('fetches pre-stop session, DELETEs, redirects to /?done=...&repo=...&branch=...', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      repo: 'https://github.com/example/x',
      branch: 'main',
    }
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({ apiResponses: [jsonResponse(session), emptyResponse(204)] }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postIntent('stop'))

    assert.equal(response.status, 302)
    const location = response.headers.get('location')!
    const params = new URL(location, ORIGIN).searchParams
    assert.equal(params.get('done'), SID)
    assert.equal(params.get('repo'), 'https://github.com/example/x')
    assert.equal(params.get('branch'), 'main')
  })

  it('redirects to / (no done param) when GET 404s and DELETE 404s — no half-broken banner', async (t) => {
    const notFound = jsonResponse({ code: 'not_found', message: 'gone' }, { status: 404 })
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({ apiResponses: [notFound, notFound] }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postIntent('stop'))

    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/')
  })

  it('re-renders the page with status 503 + inline error when DELETE fails non-404', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      repo: 'https://github.com/example/x',
      branch: 'main',
    }
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({
        apiResponses: [
          jsonResponse(session),
          jsonResponse({ code: 'k8s_unavailable', message: 'cluster down' }, { status: 503 }),
        ],
      }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postIntent('stop'))

    assert.equal(response.status, 503)
    const html = await response.text()
    assert.match(html, /Your session is live/)
    assert.match(html, /Couldn't stop/)
    assert.match(html, /cluster down/)
  })

  it('re-throws when GET fails with a 5xx (do not silently lose context)', async (t) => {
    let deleteCalled = false
    t.mock.method(
      globalThis,
      'fetch',
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.startsWith(BASE) && init?.method === 'DELETE') {
          deleteCalled = true
          return new Response(null, { status: 204 })
        }
        if (url.startsWith(BASE)) {
          return new Response(JSON.stringify({ code: 'k8s_unavailable', message: 'down' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(null, { status: 200 })
      }) as typeof globalThis.fetch,
    )

    const router = createLandingRouter()
    await assert.rejects(
      () => router.fetch(postIntent('stop')),
      (error: unknown) => error instanceof Error && error.message.includes('down'),
    )
    // The point: do not silently swallow the GET error and proceed
    // with the DELETE — that would lose repo/branch context.
    assert.equal(deleteCalled, false)
  })
})

describe('POST /sessions/:id (intent dispatch)', () => {
  function postBody(body: URLSearchParams): Request {
    return new Request(`${ORIGIN}/sessions/${SID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  }

  it('returns 400 for missing intent (no destructive default)', async () => {
    const router = createLandingRouter()
    const response = await router.fetch(postBody(new URLSearchParams({})))
    assert.equal(response.status, 400)
  })

  it('returns 400 for unknown intent', async () => {
    const router = createLandingRouter()
    const response = await router.fetch(postBody(new URLSearchParams({ intent: 'pwn' })))
    assert.equal(response.status, 400)
  })
})

describe('POST /sessions/:id (intent=cancel)', () => {
  function postIntent(intent: string): Request {
    return new Request(`${ORIGIN}/sessions/${SID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ intent }).toString(),
    })
  }

  it('DELETEs and redirects to /', async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({ apiResponses: [emptyResponse(204)] }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postIntent('cancel'))

    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/')
  })

  it('treats DELETE 404 as success (already gone) and redirects to /', async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({
        apiResponses: [jsonResponse({ code: 'not_found', message: 'gone' }, { status: 404 })],
      }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postIntent('cancel'))

    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/')
  })

  it('redirects to / even when DELETE returns 503 (cancel is best-effort)', async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({
        apiResponses: [
          jsonResponse({ code: 'k8s_unavailable', message: 'down' }, { status: 503 }),
        ],
      }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postIntent('cancel'))

    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/')
  })
})
