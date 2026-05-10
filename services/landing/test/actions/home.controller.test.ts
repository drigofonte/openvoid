import * as assert from 'remix/assert'
import { afterEach, beforeEach, describe, it } from 'remix/test'

import { setApiBase } from '../../app/utils/api.ts'
import { createLandingRouter } from '../../app/router.ts'

const BASE = 'http://session-api.test'
const ORIGIN = 'http://localhost'
const SID = '01HABCDEF'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function postForm(body: URLSearchParams): Request {
  return new Request(`${ORIGIN}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

function extractIdempotencyKey(html: string): string {
  const match = html.match(/name="idempotencyKey" value="([^"]+)"/)
  assert.ok(match, 'idempotencyKey hidden field missing')
  return match[1]!
}

// Default repo/branch the controller injects server-side. Mirrors
// the constants in `app/actions/home/controller.tsx`. Tests assert
// the upstream `createSession` body carries these regardless of
// what the form posts (the form no longer renders those inputs;
// the controller overwrites them via `formData.set` even if a
// rogue request includes them).
const DEFAULT_REPO = 'https://github.com/drigofonte/openvoid-test.git'
const DEFAULT_BRANCH = 'main'

function validForm(): URLSearchParams {
  return new URLSearchParams({
    idempotencyKey: 'idem-test-1',
    prompt: 'Add a /health endpoint',
  })
}

beforeEach(() => {
  setApiBase(BASE)
})

afterEach(() => {
  setApiBase(undefined)
})

describe('home / index', () => {
  it('renders the Create page on GET /', async () => {
    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/`))

    assert.equal(response.status, 200)
    const html = await response.text()
    // New Hi-Fi headline + composer shape.
    assert.match(html, /Let's make something\./)
    assert.match(html, /name="prompt"/)
    // Crumbs chrome with "new app" segment + Back-to-apps link.
    assert.match(html, /class="wf-toolbar wf-toolbar-tall"/)
    assert.match(html, />new app</)
    assert.match(html, /Back to apps/)
    // Composer is rendered as a single elevated form with the
    // .wf-composer recipe.
    assert.match(html, /<form\b[^>]*\bclass="[^"]*\bwf-composer\b[^"]*"/)
    // Repo/branch inputs are gone — controller defaults them.
    assert.doesNotMatch(html, /name="repo"/)
    assert.doesNotMatch(html, /name="branch"/)
    // The advanced expander is gone too.
    assert.doesNotMatch(html, /<details\b/)
    // Old wireframe copy no longer renders.
    assert.doesNotMatch(html, /What should we build today/)
    assert.doesNotMatch(html, /Step 1 of 1/)
  })

  it('renders a fresh idempotencyKey on every GET render', async () => {
    const router = createLandingRouter()
    const html1 = await (await router.fetch(new Request(`${ORIGIN}/`))).text()
    const html2 = await (await router.fetch(new Request(`${ORIGIN}/`))).text()

    assert.notEqual(extractIdempotencyKey(html1), extractIdempotencyKey(html2))
  })

  it('renders the Done banner when ?done=&repo=&branch= is present', async () => {
    const router = createLandingRouter()
    const url = `${ORIGIN}/?done=${SID}&repo=${encodeURIComponent('https://github.com/example/x.git')}&branch=main`
    const response = await router.fetch(new Request(url))

    const html = await response.text()
    assert.match(html, /Saved/)
    assert.match(html, new RegExp(`feat/${SID}`))
    assert.match(html, /github\.com\/example\/x\/tree\/feat%2F/)
  })

  it('hides the Done banner when ?done is missing repo or branch', async () => {
    const router = createLandingRouter()
    const response = await router.fetch(new Request(`${ORIGIN}/?done=${SID}`))

    const html = await response.text()
    assert.doesNotMatch(html, /Saved/)
  })
})

describe('home / create', () => {
  it('redirects to /sessions/:id on a successful create', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ sessionId: SID, status: 'Pending' as const }, { status: 201 }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postForm(validForm()))

    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), `/sessions/${SID}`)

    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit]
    assert.equal(url, `${BASE}/sessions`)
    const headers = init.headers as Record<string, string>
    assert.equal(headers['Idempotency-Key'], 'idem-test-1')
    const body = JSON.parse(init.body as string)
    // Controller injects DEFAULT_REPO / DEFAULT_BRANCH via
    // formData.set — repo/branch never come from user input in v1.
    assert.equal(body.repo, DEFAULT_REPO)
    assert.equal(body.branch, DEFAULT_BRANCH)
  })

  it('overrides any user-submitted repo/branch with the server-side defaults', async (t) => {
    // Belt-and-suspenders: even if a rogue form posts repo/branch,
    // the controller's formData.set wins. The form no longer
    // renders these inputs (U4), so this is purely defensive.
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ sessionId: SID, status: 'Pending' as const }, { status: 201 }),
    )

    const router = createLandingRouter()
    const body = new URLSearchParams({
      repo: 'https://github.com/rogue/repo',
      branch: 'rogue-branch',
      idempotencyKey: 'idem-test-rogue',
      prompt: 'Make something',
    })
    await router.fetch(postForm(body))

    const init = fetchMock.mock.calls[0]!.arguments[1] as RequestInit
    const upstreamBody = JSON.parse(init.body as string)
    assert.equal(upstreamBody.repo, DEFAULT_REPO)
    assert.equal(upstreamBody.branch, DEFAULT_BRANCH)
  })

  it('re-renders with status 400 when prompt is empty', async () => {
    const router = createLandingRouter()
    const empty = new URLSearchParams({ idempotencyKey: '', prompt: '' })
    const response = await router.fetch(postForm(empty))

    assert.equal(response.status, 400)
    const html = await response.text()
    assert.match(html, /Couldn't start/)
  })

  it('re-renders with status 400 when prompt is missing entirely', async () => {
    const router = createLandingRouter()
    const missing = new URLSearchParams({ idempotencyKey: 'idem-x' })
    const response = await router.fetch(postForm(missing))

    assert.equal(response.status, 400)
  })

  it('surfaces upstream invalid_request as 400 with an inline error', async (t) => {
    // The upstream Session API can still reject for reasons
    // unrelated to repo/branch (rate limits, malformed prompt,
    // etc.) — the controller's error-handling path stays under
    // test even though the user can't trigger an upstream
    // repo-validation error from the UI anymore.
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse(
        { code: 'invalid_request', message: 'something else went wrong' },
        { status: 400 },
      ),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postForm(validForm()))

    assert.equal(response.status, 400)
    const html = await response.text()
    assert.match(html, /Couldn't start/)
    assert.match(html, /something else went wrong/)
  })

  it('surfaces upstream 503 (k8s_unavailable) as 503 with an inline error', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ code: 'k8s_unavailable', message: 'cluster down' }, { status: 503 }),
    )

    const router = createLandingRouter()
    const response = await router.fetch(postForm(validForm()))

    assert.equal(response.status, 503)
    const html = await response.text()
    assert.match(html, /Couldn't start/)
    assert.match(html, /cluster down/)
  })

  it('preserves the submitted prompt when re-rendering on error', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ code: 'invalid_request', message: 'bad' }, { status: 400 }),
    )

    const router = createLandingRouter()
    const body = new URLSearchParams({
      idempotencyKey: 'idem-test-3',
      prompt: 'Keep this prompt across error renders',
    })
    const response = await router.fetch(postForm(body))

    const html = await response.text()
    // repo/branch are not user-supplied in v1; only the prompt
    // round-trips through previousValues.
    assert.match(html, /Keep this prompt across error renders/)
  })

  it('maps a network error to 502', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('connection refused')
    })

    const router = createLandingRouter()
    const response = await router.fetch(postForm(validForm()))

    assert.equal(response.status, 502)
  })

  it('persists the submitted idempotencyKey on POST error re-render', async (t) => {
    // Stable Idempotency-Key across retries is the *point* of the
    // header; regenerating it on re-render would let a successful-
    // -upstream-but-failed-response create a duplicate session on
    // the user's manual retry.
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ code: 'k8s_unavailable', message: 'cluster down' }, { status: 503 }),
    )

    const router = createLandingRouter()
    const submittedKey = 'idem-stable-1'
    const body = new URLSearchParams({
      idempotencyKey: submittedKey,
      prompt: 'do the thing',
    })
    const response = await router.fetch(postForm(body))
    const html = await response.text()

    assert.equal(extractIdempotencyKey(html), submittedKey)
  })

  it('preserves user-typed prompt + idempotencyKey when validation fails on the prompt', async () => {
    const router = createLandingRouter()
    const body = new URLSearchParams({
      idempotencyKey: 'idem-keep',
      prompt: '', // only this fails
    })
    const response = await router.fetch(postForm(body))

    assert.equal(response.status, 400)
    const html = await response.text()
    assert.equal(extractIdempotencyKey(html), 'idem-keep')
  })

  it('preserves the Done banner on POST error re-render', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ code: 'k8s_unavailable', message: 'down' }, { status: 503 }),
    )

    const router = createLandingRouter()
    const url = `${ORIGIN}/?done=${SID}&repo=${encodeURIComponent('https://github.com/example/x')}&branch=main`
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: validForm().toString(),
    })
    const response = await router.fetch(request)
    const html = await response.text()

    assert.match(html, /Saved/)
    assert.match(html, new RegExp(`feat/${SID}`))
  })
})
