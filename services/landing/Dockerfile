# syntax=docker/dockerfile:1.7
# Single-stage Dockerfile for @openvoid/landing — Remix 3 (beta) on
# Node 24-alpine, runs `tsx server.ts` directly (no separate build
# step, matching the bookstore demo's pattern).
#
# This is the **Unit 1 minimal** shape, sufficient to keep `tilt up`
# working through the redesign. Unit 5 of the landing-redesign plan
# refines this to:
#   - 3-stage build (builder / dev / runtime) matching
#     services/session-api/Dockerfile,
#   - SCC-friendly chgrp/chmod for v1.5 OpenShift readiness,
#   - hot-reload via `tsx watch` in a dev target,
#   - smaller runtime image via `pnpm deploy --prod`.
#
# Until then the dev loop runs `pnpm --filter @openvoid/landing dev`
# directly when not using Tilt.

FROM node:24-alpine

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests first for cache-friendly install order.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/protocol/package.json packages/protocol/
COPY services/landing/package.json services/landing/

RUN pnpm install --frozen-lockfile

# Copy sources.
COPY packages/protocol packages/protocol
COPY services/landing services/landing

WORKDIR /workspace/services/landing

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

CMD ["pnpm", "exec", "tsx", "server.ts"]
