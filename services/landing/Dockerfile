# syntax=docker/dockerfile:1.7
# Multi-stage build for @openvoid/landing — Remix 3 (beta) Node server.
#
# Builds inside a pnpm-aware Node-Alpine builder, then ships a pruned
# production tree into a minimal Alpine runtime that runs `tsx server.ts`
# directly (no separate compile step — matches the bookstore demo's
# pattern). `tsx` is a runtime dependency for this reason.
#
# The dev stage extends the builder so Tilt can hot-sync source files
# into the running container; `tsx watch` picks them up and restarts.

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/protocol/package.json packages/protocol/
COPY services/landing/package.json services/landing/

RUN pnpm install --frozen-lockfile

# Copy sources.
COPY packages/protocol packages/protocol
COPY services/landing services/landing

# Deploy a self-contained production tree (only prod deps + the
# package's own files). The runtime stage copies this into /app.
# tsx is a prod dep so it lands here; @openvoid/protocol is a dev
# dep (used only via `import type`, erased by tsx at runtime).
RUN pnpm --filter @openvoid/landing deploy --prod /opt/landing


# Dev stage: keeps the full workspace + dev deps so `tsx watch` can
# reload on source syncs from Tilt. Used by the root Tiltfile via
# target=dev.
FROM builder AS dev
WORKDIR /workspace/services/landing
ENV NODE_ENV=development
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "exec", "tsx", "watch", "server.ts"]


FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /opt/landing /app

# SCC-friendly permissions: arbitrary-UID-in-root-group setups (e.g.
# OpenShift) need group `0` to own the working tree. Cheap to apply
# now; avoids a re-layering when v1.5 lands on OpenShift.
RUN chgrp -R 0 /app && chmod -R g=u /app

# Run as the built-in non-root `node` user.
USER node

EXPOSE 3000
CMD ["pnpm", "exec", "tsx", "server.ts"]
