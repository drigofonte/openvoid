# syntax=docker/dockerfile:1.7
# Multi-stage build for @openvoid/landing.
# Vite builds the static bundle inside a pnpm-aware Node image, then
# the dist/ tree is copied into nginx:alpine for serving.
#
# Build-arg VITE_OPENVOID_API_URL is the only thing that differs
# between kind and DOKS — everything else is the same image. kind
# defaults bake http://api.127.0.0.1.nip.io; Phase 8 sets
# https://api.<domain> for DOKS.

ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Workspace manifests for pnpm-aware caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/protocol/package.json packages/protocol/
COPY services/landing/package.json services/landing/

RUN pnpm install --frozen-lockfile

# Sources.
COPY packages/protocol packages/protocol
COPY services/landing services/landing

ARG VITE_OPENVOID_API_URL=http://api.127.0.0.1.nip.io
ENV VITE_OPENVOID_API_URL=${VITE_OPENVOID_API_URL}

RUN pnpm --filter @openvoid/landing build


FROM nginx:1.27-alpine AS runtime
COPY services/landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/services/landing/dist /usr/share/nginx/html

EXPOSE 80
