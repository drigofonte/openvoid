#!/bin/sh
# opencode-entrypoint — OpenCode agent main-container entrypoint.
#
# Validates required env, then `exec`s `opencode serve` so the binary
# becomes PID 1 and receives SIGTERM directly. Without `exec`, the
# Phase 5 SIGTERM cascade (kubelet → main → finalizer) would not reach
# OpenCode and the finalizer's grace window would close while the agent
# was still mid-write.
#
# Requires (env):
#   OPENCODE_SERVER_PASSWORD — HTTP Basic auth password for the
#                              OpenCode HTTP API (per Phase 0.3 spike).
#                              Mounted from the cluster-scoped
#                              `opencode-server-password` Secret.
#
# Reads (file mount, optional at boot):
#   $XDG_DATA_HOME/opencode/auth.json — LLM provider credentials,
#       projected from the cluster-scoped `opencode-auth` Secret. The
#       server boots fine without this; `/global/health` returns 200,
#       but prompt requests fail with an upstream-auth error. That's
#       the expected failure mode for "agent up but cannot reach LLM"
#       and is documented as such in Phase 6.2.

set -eu

# If the image is invoked with an explicit command (e.g.
# `docker run … opencode --version` or `… id` for image validation,
# or kubectl exec for debugging), pass it through unchanged. Only
# the default no-arg invocation goes through the serve path that
# requires OPENCODE_SERVER_PASSWORD.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "[opencode] OPENCODE_SERVER_PASSWORD is required (mount the opencode-server-password Secret)" >&2
  exit 1
fi

exec opencode serve --hostname 0.0.0.0 --port 8080
