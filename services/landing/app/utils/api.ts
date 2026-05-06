import type { components } from '@openvoid/protocol'

/**
 * Server-only fetch wrapper around the Session API.
 *
 * Controllers run in the Remix server runtime, so these helpers
 * never ship to a browser. They read `OPENVOID_API_URL` per call so
 * tests can swap the base URL via {@link setApiBase}.
 *
 * Errors normalize to {@link ApiError} regardless of cause:
 * - HTTP 4xx/5xx responses with a JSON `{code, message}` body keep
 *   the upstream `code` and `message`; `status` is the HTTP status.
 * - HTTP 4xx/5xx without a parseable body fall back to a generic
 *   `code` derived from the status family.
 * - Network failures (DNS, refused, aborted) surface as
 *   `status: 0`, `code: 'network_error'`.
 */

type Session = components['schemas']['Session']
type CreateSessionRequest = components['schemas']['CreateSessionRequest']
type ApiErrorBody = components['schemas']['ApiError']

export interface ApiErrorOptions {
  code: string
  message: string
  status: number
  cause?: unknown
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(options: ApiErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ApiError'
    this.code = options.code
    this.status = options.status
  }
}

let apiBaseOverride: string | undefined

/**
 * Override the API base URL. Test-only; production reads from env.
 * Pass `undefined` to clear and fall back to `OPENVOID_API_URL`.
 */
export function setApiBase(url: string | undefined): void {
  apiBaseOverride = url
}

function getApiBase(): string {
  const base = apiBaseOverride ?? process.env.OPENVOID_API_URL
  if (!base) {
    throw new ApiError({
      code: 'config_error',
      message: 'OPENVOID_API_URL is not set; cannot reach the Session API.',
      status: 0,
    })
  }
  return base.replace(/\/+$/, '')
}

async function callApi(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${getApiBase()}${path}`
  try {
    return await fetch(url, init)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown'
    throw new ApiError({
      code: 'network_error',
      message: `Network error calling ${path}: ${reason}`,
      status: 0,
      cause,
    })
  }
}

async function readJsonBody<T>(response: Response, path: string): Promise<T> {
  try {
    return (await response.json()) as T
  } catch (cause) {
    throw new ApiError({
      code: 'invalid_response',
      message: `Session API returned a non-JSON body for ${path} (status ${response.status}).`,
      status: response.status,
      cause,
    })
  }
}

async function readApiError(response: Response, fallbackCode: string): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {}
  try {
    body = (await response.json()) as Partial<ApiErrorBody>
  } catch {
    // ignore — non-JSON or empty body
  }
  return new ApiError({
    code: body.code ?? fallbackCode,
    message: body.message ?? `Session API responded ${response.status} ${response.statusText}`,
    status: response.status,
  })
}

function fallbackCodeForStatus(status: number): string {
  if (status === 404) return 'not_found'
  if (status >= 500) return 'upstream_error'
  if (status >= 400) return 'invalid_request'
  return 'upstream_error'
}

/** GET /sessions/:id — throws {@link ApiError} on non-2xx or network failure. */
export async function getSession(id: string, signal?: AbortSignal): Promise<Session> {
  const path = `/sessions/${encodeURIComponent(id)}`
  const response = await callApi(path, { signal })
  if (!response.ok) {
    throw await readApiError(response, fallbackCodeForStatus(response.status))
  }
  return await readJsonBody<Session>(response, path)
}

export interface RetryOptions {
  retries?: number
  backoffMs?: number
  signal?: AbortSignal
}

/**
 * GET with retry-on-404. Defends the read-after-write race: a fresh
 * `POST /sessions` may briefly 404 on the next read while the
 * Operator catches up. 5xx is **not** retried — the controller
 * decides how to render upstream failure.
 */
export async function getSessionWithRetry(
  id: string,
  { retries = 3, backoffMs = 200, signal }: RetryOptions = {},
): Promise<Session> {
  let lastError: ApiError | undefined
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await getSession(id, signal)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error
      lastError = error
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }
  }
  throw lastError ?? new ApiError({ code: 'not_found', message: 'Session not found', status: 404 })
}

export interface CreateSessionInput {
  repo: string
  branch?: string
  idleTimeoutSeconds?: number
}

/**
 * POST /sessions. The compile-time `CreateSessionRequest` makes
 * `branch` and `idleTimeoutSeconds` required because openapi-typescript
 * treats defaulted fields as required. The form is validated by the
 * controller's schema, so we accept a relaxed input here and fill the
 * defaults at the boundary.
 */
export async function createSession(
  input: CreateSessionInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Session> {
  const body: CreateSessionRequest = {
    repo: input.repo,
    branch: input.branch ?? 'main',
    idleTimeoutSeconds: input.idleTimeoutSeconds ?? 1800,
  }
  const path = '/sessions'
  const response = await callApi(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    throw await readApiError(response, fallbackCodeForStatus(response.status))
  }
  return await readJsonBody<Session>(response, path)
}

/**
 * DELETE /sessions/:id. The protocol declares 204 as the only
 * success status, so anything else — including a 200 with a body —
 * is treated as a contract violation.
 */
export async function deleteSession(id: string, signal?: AbortSignal): Promise<void> {
  const path = `/sessions/${encodeURIComponent(id)}`
  const response = await callApi(path, { method: 'DELETE', signal })
  if (response.status === 204) return
  throw await readApiError(response, fallbackCodeForStatus(response.status))
}
