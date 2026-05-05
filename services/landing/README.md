# @openvoid/landing

Throwaway Phase 7 landing page. Vanilla TypeScript + Vite, served by
nginx in the cluster. Drives the [Session API](../session-api) from a
browser at `http://app.127.0.0.1.nip.io/` (kind) or
`https://app.<domain>/` (DOKS, Phase 8).

This package is **intentionally short-lived** — the long-term front-end
will replace it. Don't extract abstractions or build a design system
here. If a feature wants more than ~50 lines of behavior, reconsider
whether it belongs in the throwaway page or in whatever comes next.

## Local dev

```bash
# From the repo root:
pnpm --filter @openvoid/landing dev
```

Vite serves the page at <http://localhost:5173/>. By default the page
calls the Session API at the URL set in `VITE_OPENVOID_API_URL` — if
unset, requests are relative (which works inside the cluster, not
locally with `pnpm dev`). For pure UI hacking you can leave it unset
and stub the API.

## Build

```bash
pnpm --filter @openvoid/landing build
```

Output lands at `services/landing/dist/`.

## Docker / cluster

The kind flow is driven by Tilt — the Tiltfile builds the image as
`localhost:5001/openvoid/landing:dev` with `VITE_OPENVOID_API_URL=
http://api.127.0.0.1.nip.io` and applies `infra/local/landing.yaml`.

To build manually:

```bash
docker build \
  -t localhost:5001/openvoid/landing:dev \
  -f services/landing/Dockerfile \
  --build-arg VITE_OPENVOID_API_URL=http://api.127.0.0.1.nip.io \
  .
```

## Files

- `index.html` — page shell with the four state sections.
- `src/app.ts` — DOM wiring + polling loops.
- `src/state.ts` — pure state machine (testable without happy-dom).
- `src/api.ts` — typed fetch wrapper around `@openvoid/protocol`.
- `src/styles.css` — ~150 lines of hand-rolled CSS.
- `nginx.conf` — single SPA fallback, hashed-asset caching.
- `Dockerfile` — multi-stage Vite build → nginx:alpine.
