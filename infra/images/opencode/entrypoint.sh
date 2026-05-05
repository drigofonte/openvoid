#!/bin/sh
# opencode-entrypoint — OpenCode agent main-container entrypoint.
#
# Acts as a tiny init: stays PID 1, runs `opencode serve` as a child,
# and forwards SIGTERM to it on container shutdown. Naive `exec` into
# `opencode serve` does not work — the OpenCode binary does not
# install a SIGTERM handler, and Linux ignores default-terminate
# signals to PID 1, so the kubelet's SIGTERM during the Phase 5
# cascade (kubelet → main → finalizer) lands on a process that does
# nothing with it and the container only exits on SIGKILL after the
# grace period. With this script as PID 1, SIGTERM goes to the shell,
# the trap forwards it to the child opencode process (which is not
# PID 1 and so honours the default Terminate disposition), and the
# container exits cleanly within seconds — long before the
# finalizer's grace window expires.
#
# Requires (env):
#   OPENCODE_SERVER_PASSWORD — HTTP Basic auth password for the
#                              OpenCode HTTP API (per Phase 0.3 spike).
#                              Mounted from the cluster-scoped
#                              `opencode-server-password` Secret.
#
# Reads (file mount, content-optional at boot):
#   $XDG_DATA_HOME/opencode/auth.json — LLM provider credentials,
#       projected from the cluster-scoped `opencode-auth` Secret. If
#       this file is present but its contents are empty/malformed
#       (no usable provider entry), the server still boots,
#       `/global/health` returns 200, and prompt requests fail with
#       an upstream-auth error — the expected "agent up but cannot
#       reach LLM" mode. The Secret resource itself is required:
#       if `opencode-auth` is absent from the cluster, the kubelet
#       blocks the pod with CreateContainerConfigError before this
#       entrypoint ever runs (the volumeMount is not declared
#       optional). Both Secrets must be applied out-of-band before
#       creating sessions; the demo scripts check for this.

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

# Install the trap before backgrounding the child so a SIGTERM
# arriving during the microsecond between `&` and `trap` cannot land
# on a signal-naïve PID 1. The `${CHILD:-}` default makes the trap
# safe to fire before CHILD is set — `kill -TERM ""` and
# `wait ""` are both no-ops at the redirected `2>/dev/null`. Once
# CHILD is set, SIGTERM is forwarded to the real child process.
#
# `kill -TERM` is load-bearing: opencode does not catch SIGTERM as
# PID 1 (Linux's PID-1 special case), but as a non-PID-1 child it
# terminates on the default disposition.
trap 'kill -TERM "${CHILD:-}" 2>/dev/null; wait "${CHILD:-}" 2>/dev/null' TERM INT

opencode serve --hostname 0.0.0.0 --port 8080 &
CHILD=$!

wait "$CHILD"
