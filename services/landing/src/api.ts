// Tiny typed wrapper around the Session API. The shape of the
// `Session` and `ApiError` payloads comes from @openvoid/protocol's
// generated types so renames in main.tsp surface as type errors here.
//
// `CreateSessionInput` deliberately doesn't reuse the generated
// `CreateSessionRequest` type. openapi-typescript treats fields that
// carry a `default:` in the OpenAPI spec (branch, idleTimeoutSeconds)
// as required, which contradicts how the API actually accepts them.
// Defining the input shape here keeps the call site honest.

import type { components } from "@openvoid/protocol";

export type Session = components["schemas"]["Session"];
export type ApiError = components["schemas"]["ApiError"];

export type CreateSessionInput = {
  repo: string;
  branch?: string;
  idleTimeoutSeconds?: number;
};

const API_BASE = (import.meta.env.VITE_OPENVOID_API_URL ?? "").replace(/\/$/, "");

export class ApiCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiCallError";
  }
}

async function asJson(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function call<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    // CORS denials, DNS failures, refused TCP — all surface here as
    // TypeError. The landing page renders this as "API unreachable".
    const message = err instanceof Error ? err.message : "network error";
    throw new ApiCallError(0, "network_error", message);
  }

  const body = (await asJson(res)) as Partial<ApiError> | null;
  if (!res.ok) {
    throw new ApiCallError(
      res.status,
      body?.code ?? "http_error",
      body?.message ?? `${res.status} ${res.statusText}`,
    );
  }
  return body as T;
}

export const api = {
  apiBase: API_BASE,

  createSession(req: CreateSessionInput, signal?: AbortSignal): Promise<Session> {
    return call<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify(req),
      signal,
    });
  },

  getSession(sessionId: string, signal?: AbortSignal): Promise<Session> {
    return call<Session>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      signal,
    });
  },

  deleteSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    return call<void>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      signal,
    });
  },
};
