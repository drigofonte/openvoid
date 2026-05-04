#!/usr/bin/env bash
# Phase 6 interactive demo — drive the agent with a custom prompt.
#
# Spins up a session, opens an OpenCode session, sends your prompt
# (one shot — but the agent can issue many tool calls before
# returning), prints what changed in /workspace/repo, then asks
# whether to DELETE the session and push the edits to GitHub. If you
# answer "no", the session keeps running so you can poke at it
# yourself with `kubectl exec` or another `kubectl port-forward`.
#
# Usage:
#   ./scripts/phase6-prompt.sh "implement a small CLI in foo.py that prints fibonacci(n)"
#   ./scripts/phase6-prompt.sh < my-prompt.txt
#   ./scripts/phase6-prompt.sh                # reads prompt interactively
#
# Inputs (env, with sane defaults except where required):
#   OPENVOID_API_URL    Session API base URL (default http://localhost:4000).
#   OPENVOID_TEST_REPO  HTTPS Git URL the platform PAT can write to
#                       (required — same shape as phase6-demo.sh).
#   BRANCH              Source branch to clone (default `main`).
#   PROMPT_TIMEOUT_SECONDS  Max wait per agent turn (default 600).
#                            Substantial tasks ("write a CLI tool")
#                            can take several minutes; raise this if
#                            you're asking for big edits.
#
# Preconditions: same as phase6-demo.sh — see that script's header.
#
# Exit codes:
#   0 — completed (with or without DELETE).
#   1 — preconditions failed.
#   2 — pod never became Running.
#   3 — agent returned an upstream error.

set -euo pipefail

OPENVOID_API_URL="${OPENVOID_API_URL:-http://localhost:4000}"
BRANCH="${BRANCH:-main}"
PROMPT_TIMEOUT_SECONDS="${PROMPT_TIMEOUT_SECONDS:-600}"
NAMESPACE="openvoid-sessions"

if [ -z "${OPENVOID_TEST_REPO:-}" ]; then
  echo "error: OPENVOID_TEST_REPO is required (HTTPS Git URL)" >&2
  exit 1
fi

# --------------------------------------------------------------------
# Read the prompt: $@ joined → stdin → interactive. Stdin is checked
# only when no args are passed so a prompt with quoted arguments
# (e.g. spaces) doesn't get truncated by argument parsing.
# --------------------------------------------------------------------

if [ "$#" -gt 0 ]; then
  PROMPT="$*"
elif [ ! -t 0 ]; then
  PROMPT=$(cat)
else
  echo "Enter your prompt (Ctrl-D when done):"
  PROMPT=$(cat)
fi
if [ -z "${PROMPT// /}" ]; then
  echo "error: empty prompt" >&2
  exit 1
fi

# --------------------------------------------------------------------
# Preconditions: kind context, Secrets, API reachable. Same checks as
# phase6-demo.sh — duplicated rather than sourced to keep each script
# self-contained for copy-paste portability.
# --------------------------------------------------------------------

ctx=$(kubectl config current-context 2>/dev/null || true)
if [ "$ctx" != "kind-openvoid-local" ]; then
  echo "error: kubectl context is '$ctx', expected 'kind-openvoid-local'" >&2
  exit 1
fi

for secret in git-creds opencode-server-password opencode-auth; do
  if ! kubectl get secret -n "$NAMESPACE" "$secret" >/dev/null 2>&1; then
    echo "error: Secret '$secret' missing in namespace '$NAMESPACE'" >&2
    exit 1
  fi
done

if ! curl -sf -o /dev/null "$OPENVOID_API_URL/healthz" 2>/dev/null \
   && ! curl -sf -o /dev/null "$OPENVOID_API_URL/" 2>/dev/null; then
  echo "error: Session API not reachable at $OPENVOID_API_URL" >&2
  exit 1
fi

# --------------------------------------------------------------------
# Cleanup trap — port-forward only. We deliberately do NOT delete the
# pod or the GitHub branch on exit: the user may have answered "no"
# to keep iterating on the session, and an unexpected failure mid-run
# shouldn't destroy state they might want to inspect.
# --------------------------------------------------------------------

PF_PID=""
SID=""
SID_LC=""

cleanup() {
  rc=$?
  set +e
  if [ -n "$PF_PID" ]; then kill "$PF_PID" 2>/dev/null; fi
  # Print the keep-alive notice on any exit where the pod is still
  # alive — both the "user answered no" happy path AND mid-script
  # error paths. The DELETE happy path nulls out SID_LC so we don't
  # print a stale handle to a pod that's already gone.
  if [ -n "$SID_LC" ] \
     && kubectl get pod -n "$NAMESPACE" "session-$SID_LC" >/dev/null 2>&1; then
    echo
    if [ "$rc" -ne 0 ]; then
      echo "(script exited with status $rc — session was NOT deleted)"
    fi
    echo "Session is still running. To inspect:"
    echo "  kubectl exec -n $NAMESPACE session-$SID_LC -c session        -- ls -la /workspace/repo"
    # `git` lives only on the git-finalizer sidecar (alpine/git-based
    # image). The agent main container is node:20-alpine + the
    # opencode binary; it deliberately does not include git.
    echo "  kubectl exec -n $NAMESPACE session-$SID_LC -c git-finalizer  -- git -C /workspace/repo status"
    echo "  kubectl port-forward -n $NAMESPACE session-$SID_LC 18080:8080"
    echo "To tear down (and push the edits):"
    echo "  curl -X DELETE $OPENVOID_API_URL/sessions/$SID"
  fi
}
trap cleanup EXIT

# --------------------------------------------------------------------
# Step 1: create the session and wait for Running. Same shape as
# phase6-demo.sh — see that script for the per-step rationale.
# --------------------------------------------------------------------

echo "==> creating session against $OPENVOID_TEST_REPO ($BRANCH)"
SID=$(curl -sf -X POST "$OPENVOID_API_URL/sessions" \
  -H 'content-type: application/json' \
  -d "{\"repo\":\"$OPENVOID_TEST_REPO\",\"branch\":\"$BRANCH\"}" \
  | jq -r .sessionId)
SID_LC=$(echo "$SID" | tr '[:upper:]' '[:lower:]')
echo "    sessionId=$SID  pod=session-$SID_LC"

deadline=$(( $(date +%s) + 90 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  phase=$(kubectl get pod -n "$NAMESPACE" "session-$SID_LC" \
    -o jsonpath='{.status.phase}' 2>/dev/null || true)
  if [ "$phase" = "Running" ]; then break; fi
  sleep 2
done
if [ "$phase" != "Running" ]; then
  echo "error: pod did not reach Running within 90s" >&2
  exit 2
fi

# --------------------------------------------------------------------
# Step 2: port-forward, open an OpenCode session.
# --------------------------------------------------------------------

PASSWORD=$(kubectl get secret -n "$NAMESPACE" opencode-server-password \
  -o jsonpath='{.data.password}' | base64 -d)
kubectl port-forward -n "$NAMESPACE" "session-$SID_LC" 18080:8080 \
  >/tmp/phase6-prompt-pf.log 2>&1 &
PF_PID=$!
sleep 3

OS_SID=$(curl -sf -u "opencode:$PASSWORD" -X POST http://localhost:18080/session \
  -H 'content-type: application/json' -d '{}' | jq -r .id)
echo "    opencode session: $OS_SID"

# --------------------------------------------------------------------
# Step 3: snapshot the repo BEFORE the agent runs, so we can diff
# against AFTER and show only what the agent actually changed. `git
# status --short` is more useful than `find` here because it
# distinguishes added / modified / deleted, ignores .git internals,
# and respects .gitignore.
#
# Important: `git` is only available on the `git-finalizer` sidecar,
# not on the agent main container. The agent image is node:20-alpine
# plus the opencode binary; deliberately no git CLI. Both containers
# share the workspace emptyDir, so `git -C /workspace/repo` from the
# sidecar sees the same files the agent has been editing.
# --------------------------------------------------------------------

echo "==> snapshotting repo state before prompt"
kubectl exec -n "$NAMESPACE" "session-$SID_LC" -c git-finalizer -- \
  git -C /workspace/repo rev-parse HEAD 2>/dev/null \
  > /tmp/phase6-prompt-head-before || echo "(no HEAD)" > /tmp/phase6-prompt-head-before

# --------------------------------------------------------------------
# Step 4: send the prompt. We pipe the user-supplied text through jq
# to JSON-encode it safely (handles quotes, newlines, backslashes,
# unicode without manual escaping). The agent may issue many tool
# calls before the response returns; PROMPT_TIMEOUT_SECONDS sets the
# upper bound for a single turn.
# --------------------------------------------------------------------

echo "==> sending prompt (up to ${PROMPT_TIMEOUT_SECONDS}s):"
echo "----"
echo "$PROMPT"
echo "----"

START=$(date +%s)
RESP=$(curl -sf -u "opencode:$PASSWORD" -X POST \
  "http://localhost:18080/session/$OS_SID/message" \
  -H 'content-type: application/json' \
  --data-binary "$(jq -nc --arg t "$PROMPT" '{parts:[{type:"text",text:$t}]}')" \
  --max-time "$PROMPT_TIMEOUT_SECONDS")
ELAPSED=$(( $(date +%s) - START ))

ERR=$(echo "$RESP" | jq -r '.info.error.name // "null"')
MODEL=$(echo "$RESP" | jq -r '.info.modelID')
COST=$(echo "$RESP" | jq -r '.info.cost // 0')
TOKENS_IN=$(echo "$RESP" | jq -r '.info.tokens.input // 0')
TOKENS_OUT=$(echo "$RESP" | jq -r '.info.tokens.output // 0')

echo
echo "==> response (${ELAPSED}s, model=$MODEL)"
echo "    cost: \$$COST  tokens: $TOKENS_IN in / $TOKENS_OUT out"

if [ "$ERR" != "null" ]; then
  echo "error: agent returned an error: $ERR" >&2
  echo "$RESP" | jq '.info.error' >&2
  exit 3
fi

# Print the agent's final text reply (may be the only `text` part, or
# the last after intermediate tool calls).
echo
echo "agent reply:"
echo "$RESP" | jq -r '[.parts[] | select(.type=="text") | .text] | join("\n\n")'

# --------------------------------------------------------------------
# Step 5: show what changed in the repo. The agent has been editing
# at /workspace/repo; we run `git status` and `git diff --stat`
# inside the pod to summarise. Useful for a quick smell test before
# committing to a DELETE.
# --------------------------------------------------------------------

echo
echo "==> repo changes in /workspace/repo (via git-finalizer sidecar):"
kubectl exec -n "$NAMESPACE" "session-$SID_LC" -c git-finalizer -- \
  git -C /workspace/repo status --short
echo
kubectl exec -n "$NAMESPACE" "session-$SID_LC" -c git-finalizer -- \
  git -C /workspace/repo diff --stat 2>/dev/null || true

# --------------------------------------------------------------------
# Step 6: ask whether to DELETE. "yes" triggers the SIGTERM cascade;
# the finalizer commits + pushes the agent's edits to feat/<sid> and
# we print the GitHub URL. "no" leaves the pod up so you can iterate
# (kubectl exec / port-forward) and DELETE manually later.
# --------------------------------------------------------------------

echo
read -r -p "DELETE session and push edits to GitHub? [y/N] " ANSWER
if [ "${ANSWER:-N}" != "y" ] && [ "${ANSWER:-N}" != "Y" ]; then
  KEEP_NOTICE=1
  exit 0
fi

# Stop the port-forward before DELETE so we don't see termination spam.
kill "$PF_PID" 2>/dev/null
PF_PID=""

echo "==> DELETE /sessions/$SID"
curl -sf -o /dev/null -X DELETE "$OPENVOID_API_URL/sessions/$SID"

echo "==> waiting for pod terminate"
START=$(date +%s)
deadline=$(( START + 90 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if ! kubectl get pod -n "$NAMESPACE" "session-$SID_LC" >/dev/null 2>&1; then
    echo "    pod gone after $(( $(date +%s) - START ))s"
    break
  fi
  sleep 2
done

# --------------------------------------------------------------------
# Step 7: print the branch URL. We don't auto-clean it like the demo
# script does — the user prompted for "something more challenging"
# and probably wants to review the PR.
# --------------------------------------------------------------------

REPO_PATH=$(printf '%s' "$OPENVOID_TEST_REPO" \
  | sed -E 's#^https?://github\.com/##; s#\.git$##; s#/$##')
DEMO_BRANCH="feat/$SID_LC"

echo
echo "branch:    https://github.com/$REPO_PATH/tree/$DEMO_BRANCH"
echo "open PR:   https://github.com/$REPO_PATH/compare/$BRANCH...$DEMO_BRANCH?expand=1"
