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
#   3. Sentinel file absent (idempotency across entrypoint restarts
#      within one pod lifetime)
#
# Idempotency is double-protected: the local sentinel is the fast path,
# but the script also queries OpenCode's session list for our title
# before creating a new session — so an entrypoint restart after a
# crashed seed cannot double-seed.
#
# Transient failures (health timeout, network errors, HTTP 5xx) leave
# the sentinel absent so the next entrypoint restart retries. Permanent
# failures (4xx — auth misconfig, contract drift, malformed body) write
# the sentinel so the pod doesn't loop forever on something a retry
# can't fix.
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
# Required env (with defaults):
#   OPENCODE_SERVER_PASSWORD               (no default; hard-required)
#   OPENVOID_SEED_PROMPT_PATH              /workspace/repo/app/scaffold-meta.json
#   OPENVOID_SEED_SENTINEL_PATH            /workspace/.openvoid-seeded
#   OPENVOID_SEED_OPENCODE_URL             http://127.0.0.1:8080
#   OPENVOID_SEED_HEALTH_TIMEOUT_S         120
#   OPENVOID_SEED_SESSION_TITLE            openvoid auto-seed
#   OPENVOID_SEED_PROMPT_MAX_BYTES         4096

set -euo pipefail

log() { printf '[seed] %s\n' "$*" >&2; }

PROMPT_PATH="${OPENVOID_SEED_PROMPT_PATH:-/workspace/repo/app/scaffold-meta.json}"
SENTINEL_PATH="${OPENVOID_SEED_SENTINEL_PATH:-/workspace/.openvoid-seeded}"
OPENCODE_URL="${OPENVOID_SEED_OPENCODE_URL:-http://127.0.0.1:8080}"
HEALTH_TIMEOUT_S="${OPENVOID_SEED_HEALTH_TIMEOUT_S:-120}"
SESSION_TITLE="${OPENVOID_SEED_SESSION_TITLE:-openvoid auto-seed}"
PROMPT_MAX_BYTES="${OPENVOID_SEED_PROMPT_MAX_BYTES:-4096}"

write_sentinel() {
  touch "$SENTINEL_PATH" 2>/dev/null || log "warning: could not write sentinel at $SENTINEL_PATH"
}

# Fast-path: prior seed already ran in this pod's lifetime.
if [ -f "$SENTINEL_PATH" ]; then
  log "sentinel present at $SENTINEL_PATH; skipping"
  exit 0
fi

if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  log "OPENCODE_SERVER_PASSWORD unset; cannot authenticate to OpenCode"
  # Auth misconfig is permanent — operator must fix the Secret + restart.
  write_sentinel
  exit 0
fi

# Missing meta-file is treated as "no prompt to seed". A future scaffold
# bump that renames or removes the file falls through here rather than
# crashing the pod's log stream.
if [ ! -f "$PROMPT_PATH" ]; then
  log "prompt file absent at $PROMPT_PATH; nothing to seed"
  write_sentinel
  exit 0
fi

# Read + length-bound the prompt. The bound is a defense-in-depth
# nudge against unbounded prompt-injection payloads — not a substitute
# for sanitization. See infra/images/opencode/README.md "Seed-on-boot"
# for the prompt-injection acknowledgment.
raw_prompt=$(jq -r '.prompt // ""' "$PROMPT_PATH" 2>/dev/null || true)
if [ -z "$raw_prompt" ]; then
  log "prompt is empty in $PROMPT_PATH; nothing to seed"
  write_sentinel
  exit 0
fi
prompt_bytes=${#raw_prompt}
if [ "$prompt_bytes" -gt "$PROMPT_MAX_BYTES" ]; then
  log "prompt is $prompt_bytes bytes; truncating to $PROMPT_MAX_BYTES"
  prompt=$(printf '%s' "$raw_prompt" | head -c "$PROMPT_MAX_BYTES")
else
  prompt="$raw_prompt"
fi

# Wrap the raw prompt with one sentence of framing + an inline
# "extend, don't rebuild" reinforcement. Even with scaffold-extend.md
# correctly loaded (U2), this re-states the constraint so the first
# turn can't miss it.
framed_prompt="The user described the app they want you to build: ${prompt}

Please start implementing this now. Extend the existing scaffold rather than rebuilding it from scratch — \`app/routes/_index.tsx\` is your starting canvas. Add new routes under \`app/routes/\` and pull in libraries (styling, state, auth, etc.) only as the requirements warrant."

# Wait for OpenCode's app-level health, not pod-level Ready. Pod-Ready
# gates on Vite (:3000); OpenCode runs on :8080 and may need more time
# for first-boot DB migration. Bounded by HEALTH_TIMEOUT_S; transient
# (don't sentinel) on giveup so the next entrypoint restart retries.
log "waiting up to ${HEALTH_TIMEOUT_S}s for OpenCode health at $OPENCODE_URL"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -sfu "opencode:${OPENCODE_SERVER_PASSWORD}" \
      "${OPENCODE_URL}/global/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  log "giving up: OpenCode never became healthy within ${HEALTH_TIMEOUT_S}s (transient — entrypoint restart will retry)"
  exit 0
fi
log "OpenCode healthy"

# Idempotency check: if a session with our title already exists, reuse
# it. Defends against the case where the sentinel got cleaned up but
# OpenCode's own session list still has the prior attempt.
existing_id=$(curl -sfu "opencode:${OPENCODE_SERVER_PASSWORD}" \
    "${OPENCODE_URL}/session" 2>/dev/null \
  | jq -r --arg t "$SESSION_TITLE" '.[] | select(.title==$t) | .id' 2>/dev/null \
  | head -n1 \
  || true)

session_id=""
if [ -n "$existing_id" ]; then
  log "reusing existing session $existing_id (title: $SESSION_TITLE)"
  session_id="$existing_id"
else
  # Create a new session.
  create_body=$(jq -n --arg t "$SESSION_TITLE" '{title:$t}')
  create_response=$(mktemp)
  create_status=$(curl -sS -u "opencode:${OPENCODE_SERVER_PASSWORD}" \
    -H 'Content-Type: application/json' \
    -X POST -d "$create_body" \
    -w '%{http_code}' \
    -o "$create_response" \
    "${OPENCODE_URL}/session" 2>/dev/null || echo "000")
  case "$create_status" in
    2*)
      session_id=$(jq -r '.id // empty' "$create_response" 2>/dev/null || true)
      rm -f "$create_response"
      if [ -z "$session_id" ]; then
        log "giving up: session-create returned ${create_status} but no .id in body (contract drift — permanent)"
        write_sentinel
        exit 0
      fi
      log "created session $session_id"
      ;;
    401|403|404|422)
      log "giving up: session-create returned ${create_status} (permanent — auth misconfig or API contract drift)"
      rm -f "$create_response"
      write_sentinel
      exit 0
      ;;
    *)
      log "giving up: session-create returned ${create_status} (transient — entrypoint restart will retry)"
      rm -f "$create_response"
      exit 0
      ;;
  esac
fi

# Send the framed prompt as a user message. Blocking call — the agent
# runs the full build-mode turn before this returns. Script holds open
# as a backgrounded sibling of pnpm dev + opencode serve, so blocking
# here is fine; the dual-process layout keeps the pod running.
message_body=$(jq -n --arg t "$framed_prompt" \
  '{parts:[{type:"text", text:$t}], agent:"build"}')
message_status=$(curl -sS -u "opencode:${OPENCODE_SERVER_PASSWORD}" \
  -H 'Content-Type: application/json' \
  -X POST -d "$message_body" \
  -w '%{http_code}' \
  -o /dev/null \
  "${OPENCODE_URL}/session/${session_id}/message" 2>/dev/null || echo "000")
case "$message_status" in
  2*)
    log "seed message accepted; agent is running"
    write_sentinel
    exit 0
    ;;
  401|403|404|422)
    log "giving up: send-message returned ${message_status} (permanent — auth misconfig or API contract drift)"
    write_sentinel
    exit 0
    ;;
  *)
    log "giving up: send-message returned ${message_status} (transient — entrypoint restart will retry)"
    exit 0
    ;;
esac
