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
  it('U4: renders awaiting-agent-session Provisioning with sr-only copy and step-4 active', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Pending',
      pendingPhase: 'awaiting-agent-session',
    }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    assert.equal(response.status, 200)
    const html = await response.text()
    // sr-only announcement (page.tsx phaseAnnouncement arm)
    assert.match(html, /Starting up your coding agent/)
    // Provisioning STATUS_COPY for awaiting-agent-session
    assert.match(html, /Starting up your coding agent — your prompt is already running/)
    // Step 4 (Starting preview server) is the active step indicator
    assert.match(html, /<li id="step-4" class="step active">/)
  })

  it('renders Provisioning for a Pending session', async (t) => {
    const session: SessionShape = { sessionId: SID, status: 'Pending' }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /Spinning up/)
    // Cancel lives in the page header (topBarRight) on Provisioning,
    // not in the page body. Per U5 of plan 2026-05-12-001.
    const headerMatch = html.match(/<header[\s\S]*?<\/header>/)
    assert.notEqual(headerMatch, null, 'expected a <header> element')
    assert.match(headerMatch![0], /Cancel/)
    // CancelButton renders a form with intent=cancel.
    assert.match(headerMatch![0], /name="intent" value="cancel"/)
    // Avatar still renders alongside Cancel — the "M" letter is
    // the Avatar's default content (Hi-Fi shape).
    assert.match(headerMatch![0], />M</)
  })

  it('renders Ready when status=Running, both URLs present, ingress probe succeeds', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      agentSessionId: 'ses_x',
    }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    const html = await response.text()
    // Hero copy + Ready pill
    assert.match(html, /Sandbox ready/)
    assert.match(html, /Two tabs, and you're building/)
    // Both URLs render in their UrlRow components
    assert.match(html, new RegExp(AGENT_URL.replace(/[/.]/g, '\\$&')))
    assert.match(html, new RegExp(PREVIEW_URL.replace(/[/.]/g, '\\$&')))
    // Each card carries an "Open …" CTA
    assert.match(html, /Open chat/)
    assert.match(html, /Open preview/)
    // Split-window tip
    assert.match(html, /Drag both tabs into a split window/)
    // Done-line is now the prose link, not a separate "Stop & save" button
    assert.match(html, /Come back here and end the session/)
    assert.doesNotMatch(html, /Stop &amp; save/)
  })

  it('renders Ready chrome — crumbs mode (8-char id-prefix), Session live pill', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      agentSessionId: 'ses_x',
    }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))
    const html = await response.text()

    // App Shell wraps the body; bare <header> is shaped by
    // `.app-shell header` (canonical 56h).
    assert.match(html, /<body class="app-shell">/)
    // 8-char session-id prefix renders in the breadcrumb (single-segment).
    assert.match(html, new RegExp(`>${SID.slice(0, 8)}<`))
    // No 'maria' workspace segment in v1 — the auth layer plumbs a
    // real workspace later.
    assert.doesNotMatch(html, />maria</)
    // LivePill text — no numeric duration after it (deferred until
    // createdAt is plumbed through the View).
    assert.match(html, /Session live/)
    assert.doesNotMatch(html, /Session live\s*[·]/)
  })

  it('renders path-mode chrome on non-Ready states (Provisioning)', async (t) => {
    const session: SessionShape = { sessionId: SID, status: 'Pending' }
    t.mock.method(globalThis, 'fetch', makeFetchMock({ apiResponses: [jsonResponse(session)] }))

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))
    const html = await response.text()

    // Same App Shell as Ready — height/shape unified by canonical recipe.
    assert.match(html, /<body class="app-shell">/)
    // Decorative slug visible (the visual distinction between
    // Ready and Provisioning is content, not chrome height).
    assert.match(html, new RegExp(`/sessions/${SID}`))
    // No LivePill on non-Ready chrome.
    assert.doesNotMatch(html, /Session live/)
  })

  it('downgrades Ready→Provisioning when ingress probe fails', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      agentSessionId: 'ses_x',
    }
    t.mock.method(
      globalThis,
      'fetch',
      makeFetchMock({ apiResponses: [jsonResponse(session)], ingressOk: false }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/sessions/${SID}`))

    const html = await response.text()
    assert.match(html, /Spinning up|programming routes/i)
    assert.doesNotMatch(html, /Session ready/)
  })

  it('renders KillConfirm when ?confirm=stop is present and view is Ready', async (t) => {
    const session: SessionShape = {
      sessionId: SID,
      status: 'Running',
      agentUrl: AGENT_URL,
      previewUrl: PREVIEW_URL,
      agentSessionId: 'ses_x',
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
    assert.match(html, /Spinning up/)
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
    assert.match(html, /Spinning up/)
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
      agentSessionId: 'ses_x',
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
      agentSessionId: 'ses_x',
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
    assert.match(html, /Session ready/)
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
