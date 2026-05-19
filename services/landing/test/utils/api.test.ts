import * as assert from 'remix/assert'
import { afterEach, beforeEach, describe, it } from 'remix/test'

import {
  ApiError,
  createSession,
  deleteSession,
  getSession,
  getSessionWithRetry,
  setApiBase,
} from '../../app/utils/api.ts'

const BASE = 'http://session-api.test'
const SID = '01HABCDEF'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

beforeEach(() => {
  setApiBase(BASE)
})

afterEach(() => {
  setApiBase(undefined)
})

describe('getSession', () => {
  it('returns the parsed Session on 200', async (t) => {
    const session = { sessionId: SID, status: 'Pending' as const }
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => jsonResponse(session))

    const result = await getSession(SID)

    assert.deepEqual(result, session)
    assert.equal(fetchMock.mock.calls.length, 1)
    const [url] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit]
    assert.equal(url, `${BASE}/sessions/${SID}`)
  })

  it('throws ApiError(status=404) on 404', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ code: 'not_found', message: 'gone' }, { status: 404 }),
    )

    await assert.rejects(
      () => getSession(SID),
      (error: unknown) =>
        error instanceof ApiError && error.status === 404 && error.code === 'not_found',
    )
  })

  it('preserves upstream code on 503 (k8s_unavailable)', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ code: 'k8s_unavailable', message: 'cluster down' }, { status: 503 }),
    )

    await assert.rejects(
      () => getSession(SID),
      (error: unknown) =>
        error instanceof ApiError && error.code === 'k8s_unavailable' && error.status === 503,
    )
  })

  it('falls back to upstream_error when 5xx body is unreadable', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 502 }))

    await assert.rejects(
      () => getSession(SID),
      (error: unknown) =>
        error instanceof ApiError && error.code === 'upstream_error' && error.status === 502,
    )
  })

  it('wraps network failures as ApiError(status=0, code=network_error)', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed')
    })

    await assert.rejects(
      () => getSession(SID),
      (error: unknown) =>
        error instanceof ApiError && error.status === 0 && error.code === 'network_error',
    )
  })

  it('strips trailing slashes from the configured base URL', async (t) => {
    setApiBase(`${BASE}///`)
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ sessionId: SID, status: 'Pending' as const }),
    )

    await getSession(SID)

    const [url] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit]
    assert.equal(url, `${BASE}/sessions/${SID}`)
  })

  it('wraps a malformed JSON body on 2xx as ApiError(invalid_response)', async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    await assert.rejects(
      () => getSession(SID),
      (error: unknown) =>
        error instanceof ApiError && error.code === 'invalid_response' && error.status === 200,
    )
  })

  it('throws config_error when OPENVOID_API_URL is unset', async () => {
    setApiBase(undefined)
    const previous = process.env.OPENVOID_API_URL
    delete process.env.OPENVOID_API_URL
    try {
      await assert.rejects(
        () => getSession(SID),
        (error: unknown) => error instanceof ApiError && error.code === 'config_error',
      )
    } finally {
      if (previous !== undefined) process.env.OPENVOID_API_URL = previous
    }
  })
})

describe('getSessionWithRetry', () => {
  it('succeeds on the second attempt when the first returns 404', async (t) => {
    const session = { sessionId: SID, status: 'Pending' as const }
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
      calls++
      if (calls === 1) return jsonResponse({ code: 'not_found', message: 'x' }, { status: 404 })
      return jsonResponse(session)
    })

    const result = await getSessionWithRetry(SID, { retries: 3, backoffMs: 1 })

    assert.deepEqual(result, session)
    assert.equal(calls, 2)
  })

  it('throws after exhausting all retries when every attempt is 404', async (t) => {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
      calls++
      return jsonResponse({ code: 'not_found', message: 'x' }, { status: 404 })
    })

    await assert.rejects(
      () => getSessionWithRetry(SID, { retries: 3, backoffMs: 1 }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    )
    assert.equal(calls, 3)
  })

  it('does not retry on 5xx', async (t) => {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
      calls++
      return jsonResponse({ code: 'k8s_unavailable', message: 'x' }, { status: 503 })
    })

    await assert.rejects(
      () => getSessionWithRetry(SID, { retries: 3, backoffMs: 1 }),
      (error: unknown) => error instanceof ApiError && error.status === 503,
    )
    assert.equal(calls, 1)
  })
})

describe('createSession', () => {
  it('POSTs to /sessions with Idempotency-Key and JSON body', async (t) => {
    const session = { sessionId: SID, status: 'Pending' as const }
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse(session, { status: 201 }),
    )

    const result = await createSession(
      { repo: 'https://github.com/example/x', branch: 'main' },
      'idem-123',
    )

    assert.deepEqual(result, session)
    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit]
    assert.equal(url, `${BASE}/sessions`)
    assert.equal(init.method, 'POST')
    const headers = init.headers as Record<string, string>
    assert.equal(headers['Idempotency-Key'], 'idem-123')
    assert.equal(headers['Content-Type'], 'application/json')
    const body = JSON.parse(init.body as string)
    assert.deepEqual(body, { mode: 'import-repo', repo: 'https://github.com/example/x', branch: 'main', idleTimeoutSeconds: 1800 })
  })

  it('fills in default branch and idleTimeoutSeconds', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ sessionId: SID, status: 'Pending' as const }, { status: 201 }),
    )

    await createSession({ repo: 'https://github.com/example/x' }, 'idem-1')

    const [, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    assert.equal(body.branch, 'main')
    assert.equal(body.idleTimeoutSeconds, 1800)
  })

  it('surfaces upstream invalid_request on 400', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ code: 'invalid_request', message: 'repo must be HTTPS' }, { status: 400 }),
    )

    await assert.rejects(
      () => createSession({ repo: 'git@github.com:example/x' }, 'idem-1'),
      (error: unknown) =>
        error instanceof ApiError && error.code === 'invalid_request' && error.status === 400,
    )
  })
})

describe('deleteSession', () => {
  it('returns void on 204', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => emptyResponse(204))

    await deleteSession(SID)

    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit]
    assert.equal(url, `${BASE}/sessions/${SID}`)
    assert.equal(init.method, 'DELETE')
  })

  it('throws ApiError on non-2xx', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ code: 'k8s_unavailable', message: 'down' }, { status: 503 }),
    )

    await assert.rejects(
      () => deleteSession(SID),
      (error: unknown) =>
        error instanceof ApiError && error.code === 'k8s_unavailable' && error.status === 503,
    )
  })

  it('rejects a 200 OK response (protocol declares 204 only)', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => emptyResponse(200))

    await assert.rejects(
      () => deleteSession(SID),
      (error: unknown) => error instanceof ApiError && error.status === 200,
    )
  })
})
