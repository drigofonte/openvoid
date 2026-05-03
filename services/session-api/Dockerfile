# syntax=docker/dockerfile:1.7
# Multi-stage build for @openvoid/session-api.
# Builds inside a pnpm-aware Node-Alpine builder and copies a pruned
# production tree into a minimal Alpine runtime that runs as a non-root user.

ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/protocol/package.json packages/protocol/
COPY services/session-api/package.json services/session-api/

RUN pnpm install --frozen-lockfile

# Copy sources.
COPY packages/protocol packages/protocol
COPY services/session-api services/session-api

RUN pnpm --filter @openvoid/session-api build

# Deploy a self-contained production tree (only prod deps).
RUN pnpm --filter @openvoid/session-api deploy --prod /opt/session-api \
  && cp -R services/session-api/dist /opt/session-api/dist \
  && mkdir -p /opt/session-api/node_modules/@openvoid/protocol/generated \
  && cp packages/protocol/generated/openapi.yaml \
       /opt/session-api/node_modules/@openvoid/protocol/generated/openapi.yaml


# Dev stage: keeps full workspace + dev deps so `tsx watch` can reload on
# src/ file syncs from Tilt. Used by the root Tiltfile via target=dev.
FROM builder AS dev
WORKDIR /workspace/services/session-api
ENV NODE_ENV=development
ENV PORT=4000
EXPOSE 4000
CMD ["pnpm", "exec", "tsx", "watch", "src/server.ts"]


FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder /opt/session-api /app

# Run as the built-in non-root `node` user.
USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]
