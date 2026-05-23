#!/bin/bash
# seed-agent — auto-seed the OpenCode session with the user's
# landing-form prompt at agent-container boot.
#
# Invoked from `run_new_app()` in entrypoint.sh as a backgrounded
# sibling of `pnpm dev` and `opencode serve`. NOT named in the
# entrypoint's `wait -n` argument list — a successful seed exit
# must not collapse the pod.
#
# Gated on three signals:
#   1. OPENVOID_NEW_APP=true (set by session-api when isNewApp)
#   2. A non-empty `prompt` field in app/scaffold-meta.json (written by
#      workspace-init's run_new_app step)
#   3. Sentinel file absent (fast-path for "already seeded in this pod")
#
# Failure-mode classification:
#
#   Transient (no sentinel — retry on next entrypoint restart):
#     - Health timeout / network blips / HTTP 5xx
#     - Auth misconfig (401/403): operator can fix the Secret +
#       in-place container restart; sentinel must NOT survive that fix
#     - Empty prompt or missing meta-file (workspace-init may be late
#       or have failed mid-write)
#     - Missing OPENCODE_SERVER_PASSWORD (operator-fixable via
#       kubectl set env / Secret edit)
#
#   Permanent (write sentinel — restart won't fix this):
#     - 404/422 (API contract drift — needs a code/image change)
#     - 200 with empty SSE body on /message (upstream LLM-auth /
#       provider failure — the agent accepted the message but produced
#       no response stream)
#     - Existing session already has messages (already seeded; happy
#       path of session-by-title idempotency)
#
# Idempotency is layered:
#   - Local sentinel: fast-path for restarts after permanent outcomes
#   - Session-by-title: find prior session, GET its messages, skip POST
#     if any user message already exists (catches sentinel-loss + crash
#     between successful POST and sentinel write)
#
# Auth: HTTP Basic with username `opencode`, password from
# OPENCODE_SERVER_PASSWORD. Curl's `-u user:pass` form is the only
# permitted shape — never URL-embedded, never echoed to stdout. See
# docs/solutions/best-practices/per-session-pod-pnpm-dev-boot-traps-2026-05-22.md
# (Trap 4) for the discipline this respects.
#
# Loopback (127.0.0.1) is the only permitted host — the public agent
# URL goes through the nip.io ingress which has its own pod-loopback
# trap (docs/solutions/runtime-errors/landing-ingress-probe-stuck-
# running-pre-ingress-2026-05-09.md).
#
# Response-shape validation: per docs/spikes/2026-05-02-opencode-
# endpoints.md, OpenCode's HTTP server returns the SPA HTML shell with
# status 200 for any unknown path. Health check therefore verifies
# JSON body shape, not just status code.
#
# SIGTERM handling: the blocking POST /session/:id/message call runs
# in the background with `wait`, so the trap can forward SIGTERM to
# the in-flight curl child and exit within the pod's grace window.
# Without this, curl would outlive the script's bash PID (bash defers
# signals while blocked in $(...) command substitution).
#
# SESSION_TITLE is hardcoded to "Main" — lockstep contract with
# MAIN_SESSION_TITLE in services/session-api/src/k8s/client.ts (KD3).
# The Session API's deep-link gate (findMainSessionId) matches sessions
# by this exact title. An env knob would silently break the gate.
#
# Required env (with defaults):
#   OPENCODE_SERVER_PASSWORD               (no default; required)
#   OPENVOID_SEED_PROMPT_PATH              /workspace/repo/app/scaffold-meta.json
#   OPENVOID_SEED_SENTINEL_PATH            /workspace/.openvoid-seeded
#   OPENVOID_SEED_OPENCODE_URL             http://127.0.0.1:8080
#   OPENVOID_SEED_HEALTH_TIMEOUT_S         120
#   OPENVOID_SEED_PROMPT_MAX_CHARS         4096

set -euo pipefail

log() { printf '[seed] %s\n' "$*" >&2; }

validate_numeric() {
  local val="$1" name="$2"
  if ! [[ "$val" =~ ^[0-9]+$ ]]; then
    log "configuration error: $name must be a non-negative integer, got: ${val}"
    exit 1
  fi
}

PROMPT_PATH="${OPENVOID_SEED_PROMPT_PATH:-/workspace/repo/app/scaffold-meta.json}"
SENTINEL_PATH="${OPENVOID_SEED_SENTINEL_PATH:-/workspace/.openvoid-seeded}"
OPENCODE_URL="${OPENVOID_SEED_OPENCODE_URL:-http://127.0.0.1:8080}"
HEALTH_TIMEOUT_S="${OPENVOID_SEED_HEALTH_TIMEOUT_S:-120}"
SESSION_TITLE="Main"
PROMPT_MAX_CHARS="${OPENVOID_SEED_PROMPT_MAX_CHARS:-4096}"

# Reject non-numeric env input early. Without this, a typo like
# "300s" (Kubernetes-style timeout) would crash bash arithmetic
# silently between truncation and sentinel write — every restart
# would re-crash identically with a misleading log.
validate_numeric "$HEALTH_TIMEOUT_S" OPENVOID_SEED_HEALTH_TIMEOUT_S
validate_numeric "$PROMPT_MAX_CHARS" OPENVOID_SEED_PROMPT_MAX_CHARS

write_sentinel() {
  touch "$SENTINEL_PATH" 2>/dev/null || log "warning: could not write sentinel at $SENTINEL_PATH"
}

# Tracks the PID of an in-flight blocking curl call. The trap forwards
# SIGTERM to this PID so a long-running POST /message (the agent's
# full build-mode turn — minutes) doesn't outlive the pod's grace
# window. Reset to "" after each blocking call returns.
CURL_PID=""

trap '
  if [ -n "${CURL_PID:-}" ]; then
    kill -TERM "$CURL_PID" 2>/dev/null || true
  fi
  exit 0
' TERM INT

# Run a single curl in the background and `wait` for it, so the trap
# above can interrupt the wait and forward SIGTERM to the curl PID.
# Output contract: writes the response body to $1, the %{http_code}
# (or "000" on connection failure) to $2. Subsequent args are passed
# verbatim to curl.
#
# This pattern is reserved for the blocking POST /session/:id/message
# (which streams SSE for the entire agent turn). The short polling
# calls below use $(...) command substitution — sub-second runtimes
# absorbed comfortably by any realistic grace window.
run_blocking_curl() {
  local out_body="$1" out_status="$2"; shift 2
  # `|| echo "000"` covers the connection-failure path where curl
  # emits no http_code; the file then contains a recognizable status.
  ( curl -sS "$@" -w '%{http_code}' -o "$out_body" > "$out_status" 2>&1 || echo "000" > "$out_status" ) &
  CURL_PID=$!
  set +e
  wait "$CURL_PID"
  set -e
  CURL_PID=""
}

# Fast-path: prior seed already ran to a permanent outcome in this
# pod's lifetime. The session-by-title check below catches the
# additional case where the sentinel never got written.
if [ -f "$SENTINEL_PATH" ]; then
  log "sentinel present at $SENTINEL_PATH; skipping"
  exit 0
fi

# Auth precondition. Treated as transient (no sentinel) because the
# operator's fix path is `kubectl set env` / Secret edit + in-place
# container restart — which preserves the emptyDir (and would
# therefore preserve any sentinel we wrote here), blocking the retry.
if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  log "OPENCODE_SERVER_PASSWORD unset; cannot authenticate to OpenCode (transient — operator must populate the Secret and restart)"
  exit 0
fi

# Missing meta-file: workspace-init may have failed mid-write or
# raced with this script. Transient so a retry catches it once the
# file is fully written.
if [ ! -f "$PROMPT_PATH" ]; then
  log "prompt file absent at $PROMPT_PATH; nothing to seed (transient — entrypoint restart will retry)"
  exit 0
fi

# Read + length-bound the prompt using jq's character slice. `head -c`
# truncates by bytes and can slice mid-codepoint on multi-byte UTF-8
# (e.g. Japanese, emoji), producing invalid UTF-8 that jq's `--arg`
# rejects — so the byte-truncation form would die under set -euo
# pipefail before the framing step and never write the sentinel,
# looping forever. Slicing in jq stays UTF-8-correct and bounds the
# defense-in-depth payload size.
raw_prompt=$(jq -r --argjson n "$PROMPT_MAX_CHARS" \
  '.prompt // "" | .[:$n]' "$PROMPT_PATH" 2>/dev/null || true)
if [ -z "$raw_prompt" ]; then
  log "prompt is empty in $PROMPT_PATH; nothing to seed (transient — retry on next entrypoint restart will pick up a populated meta-file)"
  exit 0
fi

# Wrap with one sentence of framing + inline "extend, don't rebuild"
# reinforcement. Even with scaffold-extend.md correctly loaded (U2),
# this re-states the constraint so the first turn can't miss it.
framed_prompt="The user described the app they want you to build: ${raw_prompt}

Please start implementing this now. Extend the existing scaffold rather than rebuilding it from scratch — \`app/routes/_index.tsx\` is your starting canvas. Add new routes under \`app/routes/\` and pull in libraries (styling, state, auth, etc.) only as the requirements warrant."

# --- Health poll ---
# Status-aware + JSON-shape-aware. The shape check defends against
# OpenCode's SPA fallback (per spike: any unknown path returns 200
# with the web UI HTML). 401/403 is an auth misconfig — treat as
# transient (no sentinel) so an operator-fix + restart can retry.
# Other non-2xx is transient and keeps polling within the deadline.
log "waiting up to ${HEALTH_TIMEOUT_S}s for OpenCode health at $OPENCODE_URL"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
healthy=0
last_health_status=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  body=$(mktemp)
  status=$(curl -sS -u "opencode:${OPENCODE_SERVER_PASSWORD}" \
    -w '%{http_code}' \
    -o "$body" \
    "${OPENCODE_URL}/global/health" || echo "000")
  last_health_status="$status"
  case "$status" in
    2*)
      # Body must parse as JSON with healthy:true. Anything else
      # (including the SPA HTML shell on a misrouted endpoint) means
      # OpenCode's HTTP server hasn't really come up yet.
      if jq -e '.healthy == true' "$body" >/dev/null 2>&1; then
        rm -f "$body"
        healthy=1
        break
      fi
      log "health endpoint returned ${status} but body wasn't a JSON {healthy:true} (likely SPA fallback); retrying"
      ;;
    401|403)
      rm -f "$body"
      log "giving up: /global/health returned ${status} (auth misconfig — no sentinel; operator must fix opencode-server-password Secret and restart container)"
      exit 0
      ;;
    *)
      :
      ;;
  esac
  rm -f "$body"
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  log "giving up: OpenCode never became healthy within ${HEALTH_TIMEOUT_S}s (last status: ${last_health_status:-none}; transient — entrypoint restart will retry)"
  exit 0
fi
log "OpenCode healthy"

# --- Find existing session by title (idempotency) ---
session_list_body=$(mktemp)
session_list_status=$(curl -sS -u "opencode:${OPENCODE_SERVER_PASSWORD}" \
  -w '%{http_code}' -o "$session_list_body" \
  "${OPENCODE_URL}/session" || echo "000")
existing_id=""
case "$session_list_status" in
  2*)
    existing_id=$(jq -r --arg t "$SESSION_TITLE" \
      '.[] | select(.title==$t) | .id' "$session_list_body" 2>/dev/null \
      | head -n1 || true)
    ;;
  401|403)
    rm -f "$session_list_body"
    log "giving up: GET /session returned ${session_list_status} (auth misconfig — no sentinel; operator must fix Secret + restart)"
    exit 0
    ;;
  404|422)
    rm -f "$session_list_body"
    log "giving up: GET /session returned ${session_list_status} (permanent — API contract drift)"
    write_sentinel
    exit 0
    ;;
  *)
    rm -f "$session_list_body"
    log "giving up: GET /session returned ${session_list_status} (transient — entrypoint restart will retry)"
    exit 0
    ;;
esac
rm -f "$session_list_body"

session_id=""
if [ -n "$existing_id" ]; then
  # Found a session with our title. Before sending the seed turn,
  # check whether it already has messages — if yes, a prior attempt
  # POSTed the message but never wrote the sentinel (mid-stream crash,
  # SIGTERM during /message, etc.). Re-sending would inject a duplicate
  # user turn and potentially trigger rebuild-from-scratch.
  log "found existing session $existing_id (title: $SESSION_TITLE); checking for prior messages"
  msg_body=$(mktemp)
  msg_status=$(curl -sS -u "opencode:${OPENCODE_SERVER_PASSWORD}" \
    -w '%{http_code}' -o "$msg_body" \
    "${OPENCODE_URL}/session/${existing_id}/message" || echo "000")
  case "$msg_status" in
    2*)
      msg_count=$(jq 'length' "$msg_body" 2>/dev/null || echo "0")
      rm -f "$msg_body"
      if [ "$msg_count" -gt 0 ]; then
        log "session $existing_id already has $msg_count message(s); already seeded (permanent — writing sentinel)"
        write_sentinel
        exit 0
      fi
      session_id="$existing_id"
      log "session $existing_id is empty; reusing for seed turn"
      ;;
    401|403)
      rm -f "$msg_body"
      log "giving up: GET /session/${existing_id}/message returned ${msg_status} (auth misconfig — no sentinel)"
      exit 0
      ;;
    404|422)
      rm -f "$msg_body"
      log "giving up: GET /session/${existing_id}/message returned ${msg_status} (permanent — API contract drift)"
      write_sentinel
      exit 0
      ;;
    *)
      rm -f "$msg_body"
      log "giving up: GET /session/${existing_id}/message returned ${msg_status} (transient — entrypoint restart will retry)"
      exit 0
      ;;
  esac
else
  # Create a new session.
  create_body=$(jq -n --arg t "$SESSION_TITLE" '{title:$t}')
  create_response=$(mktemp)
  create_status=$(curl -sS -u "opencode:${OPENCODE_SERVER_PASSWORD}" \
    -H 'Content-Type: application/json' \
    -X POST -d "$create_body" \
    -w '%{http_code}' \
    -o "$create_response" \
    "${OPENCODE_URL}/session" || echo "000")
  case "$create_status" in
    2*)
      session_id=$(jq -r '.id // empty' "$create_response" 2>/dev/null || true)
      rm -f "$create_response"
      if [ -z "$session_id" ]; then
        log "giving up: session-create returned ${create_status} but no .id in body (permanent — API contract drift)"
        write_sentinel
        exit 0
      fi
      log "created session $session_id"
      ;;
    401|403)
      rm -f "$create_response"
      log "giving up: session-create returned ${create_status} (auth misconfig — no sentinel; operator must fix Secret + restart)"
      exit 0
      ;;
    404|422)
      rm -f "$create_response"
      log "giving up: session-create returned ${create_status} (permanent — API contract drift)"
      write_sentinel
      exit 0
      ;;
    *)
      rm -f "$create_response"
      log "giving up: session-create returned ${create_status} (transient — entrypoint restart will retry)"
      exit 0
      ;;
  esac
fi

# --- Send the seed message (blocking; SSE stream) ---
# Runs through run_blocking_curl so the trap can interrupt the wait
# and signal the curl child on SIGTERM. Body is captured (not /dev/null)
# so the post-call check can distinguish a real agent stream from a
# 200-with-empty-body silent failure (the LLM provider rejected auth
# but OpenCode still returned 200 — the documented "agent up but
# cannot reach LLM" mode from infra/images/opencode/README.md).
message_body=$(jq -n --arg t "$framed_prompt" \
  '{parts:[{type:"text", text:$t}], agent:"build"}')
message_response=$(mktemp)
message_status_file=$(mktemp)
run_blocking_curl "$message_response" "$message_status_file" \
  -u "opencode:${OPENCODE_SERVER_PASSWORD}" \
  -H 'Content-Type: application/json' \
  -X POST -d "$message_body" \
  "${OPENCODE_URL}/session/${session_id}/message"
message_status=$(cat "$message_status_file" 2>/dev/null || echo "000")
rm -f "$message_status_file"
[ -z "$message_status" ] && message_status="000"

case "$message_status" in
  2*)
    response_bytes=$(wc -c < "$message_response" 2>/dev/null | tr -d ' ' || echo "0")
    if [ "$response_bytes" -eq 0 ]; then
      log "giving up: send-message returned ${message_status} with empty body (permanent — upstream LLM auth/provider failure; the agent accepted the message but produced no response stream)"
      rm -f "$message_response"
      write_sentinel
      exit 0
    fi
    rm -f "$message_response"
    log "seed message accepted; agent stream produced ${response_bytes} bytes"
    write_sentinel
    exit 0
    ;;
  401|403)
    rm -f "$message_response"
    log "giving up: send-message returned ${message_status} (auth misconfig — no sentinel; operator must fix Secret + restart)"
    exit 0
    ;;
  404|422)
    rm -f "$message_response"
    log "giving up: send-message returned ${message_status} (permanent — API contract drift)"
    write_sentinel
    exit 0
    ;;
  *)
    rm -f "$message_response"
    log "giving up: send-message returned ${message_status} (transient — entrypoint restart will retry)"
    exit 0
    ;;
esac
