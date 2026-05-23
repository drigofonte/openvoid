#!/bin/bash
# opencode-entrypoint — OpenCode agent main-container entrypoint.
#
# Acts as a tiny init: stays PID 1, runs the agent processes as
# children, and forwards SIGTERM to them on container shutdown. Naive
# `exec` into `opencode serve` does not work — the OpenCode binary
# does not install a SIGTERM handler, and Linux ignores
# default-terminate signals to PID 1, so the kubelet's SIGTERM during
# the Phase 5 cascade (kubelet → main → finalizer) would land on a
# process that does nothing with it and the container would only exit
# on SIGKILL after the grace period. With this script as PID 1,
# SIGTERM goes to the shell, the trap forwards it to the child
# process(es) (which are not PID 1 and so honour the default
# Terminate disposition), and the container exits cleanly within
# seconds — long before the finalizer's grace window expires.
#
# Two run modes, selected by env:
#
#   import-repo (default; OPENVOID_NEW_APP unset or != "true"):
#     Single-process — just `opencode serve`. Today's v1 behaviour
#     for imported repos; the user repo decides whether/how to bring
#     up a dev server (the agent can spawn one as a tool call).
#
#   new-app (OPENVOID_NEW_APP="true"):
#     Dual-process — `pnpm dev` + `opencode serve` as siblings under
#     this script. `wait -n` exits when the first child dies so a
#     dev-server crash doesn't keep a half-broken pod alive — the
#     readinessProbe on :3000 would catch a dev crash, but not an
#     opencode crash. Coupling exit to the first death keeps the
#     pod's CrashLoopBackOff faithful to either failure.
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

set -euo pipefail

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

run_import_repo() {
  # Single-process: opencode serve only. Trap forwards SIGTERM to the
  # single child; identical shape to the pre-U8 entrypoint.
  trap 'kill -TERM "${CHILD:-}" 2>/dev/null; wait "${CHILD:-}" 2>/dev/null' TERM INT
  opencode serve --hostname 0.0.0.0 --port 8080 &
  CHILD=$!
  wait "$CHILD"
}

run_new_app() {
  # Dual-process: pnpm dev + opencode serve as siblings.
  #
  # Process substitution (`> >(sed …)`) is load-bearing: a piped
  # `… | sed …` would make $! capture the sed PID, and the trap
  # would forward SIGTERM to sed instead of pnpm/opencode. With
  # process substitution, the leader (pnpm / opencode) stays the
  # foreground job whose PID $! captures.
  pnpm --dir /workspace/repo dev > >(sed 's/^/[dev] /') 2>&1 &
  DEV_PID=$!
  opencode serve --hostname 0.0.0.0 --port 8080 > >(sed 's/^/[agent] /') 2>&1 &
  OPENCODE_PID=$!
  # seed-agent fires the user's landing-form prompt to OpenCode as
  # the agent's first user message, so the conversation is already
  # in progress when the user opens the agent UI. Backgrounded with
  # the same process-substitution log-prefix pattern; deliberately
  # NOT named in `wait -n` below — a successful seed exit must not
  # collapse the pod. The trap below covers the seed PID so SIGTERM
  # during the seed's health-poll doesn't leave an orphaned curl
  # outliving the pod's grace window.
  seed-agent > >(sed 's/^/[seed] /') 2>&1 &
  SEED_PID=$!

  trap 'kill -TERM "$DEV_PID" "$OPENCODE_PID" "$SEED_PID" 2>/dev/null || true' TERM INT

  # `wait -n` blocks until one of the named children exits and
  # returns its exit code so the pod's CrashLoopBackOff carries
  # meaningful status (rather than always-0 from `wait`). $SEED_PID
  # is intentionally absent from this list — see comment above.
  set +e
  wait -n "$DEV_PID" "$OPENCODE_PID"
  EXIT_CODE=$?
  set -e

  # First child died; bring down the survivor so the pod doesn't
  # linger as half-broken. The kubelet's readinessProbe would catch
  # a dev-server crash (probe target stops responding) but not an
  # opencode crash (probe target keeps responding from pnpm dev).
  # Coupling pod-exit to the first death keeps the failure visible.
  # Seed is also killed defensively in case it's still mid-execution.
  kill -TERM "$DEV_PID" "$OPENCODE_PID" "$SEED_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit "$EXIT_CODE"
}

if [ "${OPENVOID_NEW_APP:-}" = "true" ]; then
  run_new_app
else
  run_import_repo
fi
