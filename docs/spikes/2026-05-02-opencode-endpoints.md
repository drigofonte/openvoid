---
date: 2026-05-02
topic: opencode-endpoint-surface
status: complete
plan-unit: docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md (Unit 0.3)
opencode-version-tested: 1.14.31
---

# OpenCode Server Endpoint Surface Spike

## Why this spike exists

The plan's idle-detection mechanism (Phase 5.3 + Phase 6.3) was designed around polling a `/last-activity` endpoint on the agent pod. The plan itself flagged this as load-bearing-but-unverified. This spike resolves it before any code commits to that path.

## What was tested

- `npx --yes opencode-ai@latest` (resolved to v1.14.31) — `opencode serve --port 18765 --hostname 127.0.0.1` with `OPENCODE_SERVER_PASSWORD=spike` set.
- HTTP Basic auth with username `opencode` and password `spike`.
- Probed the documented `https://opencode.ai/docs/server/` endpoints and several speculative paths.
- Read the embedded OpenAPI spec at `GET /doc`.
- Inspected SSE event stream at `GET /global/event`.
- Created two sessions; inspected `time.created` / `time.updated` fields.

## Findings

### Auth model

- **HTTP Basic Auth**, mandatory on every request.
- Username defaults to `opencode` (override: `OPENCODE_SERVER_USERNAME`).
- Password from `OPENCODE_SERVER_PASSWORD` (required; server fails to start without it).
- Anonymous requests get HTTP 401 with body `Unauthorized`.

### Endpoints that exist (probed and confirmed working)

| Method | Path | Returns |
|---|---|---|
| GET | `/global/health` | `{"healthy": true, "version": "1.14.31"}` |
| GET | `/global/event` | SSE stream; first event is `data: {"payload":{"type":"server.connected","properties":{}}}` |
| GET | `/session` | Array of sessions, each with `id`, `slug`, `projectID`, `directory`, `path`, `title`, `version`, `time: {created, updated}` (Unix ms) |
| POST | `/session` | Creates session; returns the session object |
| GET | `/session/:id` | Single session object |
| POST | `/session/:id/message` | Send message; requires body `{parts: [...]}` (validated; rejected `{}` with a 400 detailing the missing field) |
| GET | `/session/:id/message` | Array of messages |
| GET | `/config` | `{agent: {}, mode: {}, plugin: [], command: {}, username: "..."}` |
| GET | `/provider` | List of available LLM providers and their models |
| GET | `/doc` | OpenAPI 3.1 spec as JSON (despite `Content-Type: application/json`) |
| PUT/DELETE | `/auth/{providerID}` | (declared in `/doc` spec) |
| POST | `/log` | (declared in `/doc` spec) |

### Endpoints that do NOT exist

- `GET /last-activity` — **does not exist**. Returns 200 with the SPA HTML shell because the server falls back to the web UI for unknown paths. *Any* unknown path returns the SPA shell with HTTP 200 — meaning a naive `curl -f` or status-code check cannot probe for endpoint existence.
- `GET /healthz` — does not exist (use `/global/health`).
- WebSocket — **the server does not expose any WebSocket endpoint**. Streaming is **Server-Sent Events** at `/global/event` (and `/event`).

### The trap: SPA fallback returns 200 for unknown paths

```
curl -u opencode:spike http://127.0.0.1:18765/random-nonexistent → HTTP 200 + SPA HTML
curl -u opencode:spike http://127.0.0.1:18765/last-activity      → HTTP 200 + SPA HTML
curl -u opencode:spike http://127.0.0.1:18765/healthz            → HTTP 200 + SPA HTML
```

Operator code MUST check response shape (`Content-Type` or JSON parse) when verifying an endpoint, not just status code.

### `time.updated` semantics

- `time.created` and `time.updated` are Unix milliseconds.
- For a session that has never been messaged, `time.created == time.updated`.
- `time.updated` advances when a real (validated) message is processed. Failed POSTs (e.g., 400 validation errors) do **not** advance it.

### OpenAPI spec is incomplete

`GET /doc` returns an OpenAPI 3.1 spec that declares only 2 paths (`PUT/DELETE /auth/{providerID}`, `POST /log`) — but many other endpoints clearly work. The published docs at `opencode.ai/docs/server/` are accurate; the embedded spec is partial. **Implication for codegen:** we cannot generate a TS/Go client from `/doc` alone. We'll either hand-author types in `packages/protocol` for the OpenCode endpoints we use, or fork upstream's TypeScript types from their npm package.

## Decision: idle-detection mechanism for v1

**Selected path: poll `GET /session` every 30s, compute `lastActivityTime = max(s.time.updated for s in sessions)`.**

This is option (a) modified — native polling, but against the existing `/session` list endpoint instead of a non-existent `/last-activity` endpoint. Chosen because:

- **Zero upstream dependency.** Uses an endpoint that exists and is documented.
- **No wrapper sidecar needed.** The original "wrapper" fallback option (b) is unnecessary — the activity signal is already available.
- **Polling architecture stays.** Phase 5.3 + Phase 6.3 plans don't change shape; only the URL and the response handling differ.
- **The session creator (Session API) gives the operator the session ID at CR creation time** — no enumeration needed; the operator polls just `GET /session/:id` and reads `time.updated`.

Rejected alternatives:

- Option (b) wrapper sidecar — more moving parts, no benefit when (a) works.
- Option (c) creation-time-only — strictly worse UX (sessions stop on a wall-clock deadline rather than tracking real activity).
- SSE event stream listening — more efficient for high-traffic clusters, but requires a long-lived connection from the operator and adds reconnection logic. Polling is the lower-complexity path for v1.

## Knock-on plan changes required

1. **Replace `/last-activity` references with `GET /session/:id` polling** — Phase 5.3 (idle-stop), Phase 6.3 (activity polling unit), Risks table.
2. **Replace "WebSocket" with "SSE" wherever the agent's stream is described** — Phase 9.2 (chat box wires up to SSE, not WS), the High-Level Design sequence diagram, the Cross-Platform Parity Matrix entries that mention WS routing.
3. **Auth contract clarification** — Web UI's chat-box client connects to OpenCode using HTTP Basic; the password comes from the cluster-wide `openvoid-opencode-password` Secret, surfaced through the Session API's `/sessions/{id}/agent-info` endpoint (which itself is gated by the JWT auth from Phase 9.1).
4. **Codegen note** — `packages/protocol` v1 hand-authors OpenCode types we use (just the session shape — `id`, `time.created`, `time.updated`, plus `POST /session/:id/message` body shape). Don't try to generate from `/doc`.
5. **Container build for OpenCode** — the npm package `opencode-ai` is `~94 MB` after install (large dep tree). Phase 6.1 Dockerfile should multi-stage with `npm ci --omit=dev --prefix /tmp/install opencode-ai && cp -r ...` to a minimal runtime image, or use the binary install via curl which produces a single tarball.

## Endpoints reference (for Phase 5+ implementation)

```
# Health / liveness
GET  /global/health                 → {"healthy": true, "version": "1.14.31"}

# Activity / lifecycle (operator polls these)
GET  /session                       → [Session...]
GET  /session/:id                   → Session
POST /session                       → Session  (Session API creates this on POST /sessions)

# Stream agent output (Web UI consumes via Session API proxy or directly through cloudflared)
GET  /global/event                  → text/event-stream

# Chat (Web UI sends prompts through here)
POST /session/:id/message           → SSE stream of agent output
                                       body: {"parts": [{"type": "text", "text": "..."}]}

# Auth
HTTP Basic on every request
Username: env OPENCODE_SERVER_USERNAME (default "opencode")
Password: env OPENCODE_SERVER_PASSWORD (required)
```

## Open follow-ups (not blocking Phase 1)

- Confirm SSE re-connection behavior on intermittent network — relevant for cloudflared tunnel reliability in Phase 9.4.
- Verify whether `time.updated` advances on SSE-only consumption (e.g., the user opens the SSE stream but never POSTs a message).
- Probe rate-limit behavior on `GET /session` polling at 30s intervals × N concurrent sessions (likely fine — opencode is local).
- Confirm `parts` schema for `POST /session/:id/message` — likely `[{type: "text", text: "..."}]` based on standard chat patterns; verify against opencode source if shape is non-obvious.
