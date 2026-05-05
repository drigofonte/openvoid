#!/usr/bin/env bash
# Phase 6 end-to-end demo — canned single-prompt happy path.
#
# Exercises the full per-session lifecycle introduced in Phase 6:
# Session API creates a Pod with the OpenCode main container, the
# git-clone init, and the git-finalizer native sidecar; we drive the
# agent through OpenCode's HTTP API to write a file into the cloned
# repo; DELETE triggers the SIGTERM cascade (kubelet → main →
# sidecar) which pushes the agent's edit to a feat/<sid> branch on
# GitHub; we verify the branch landed and clean it up.
#
# Inputs (env, with sane defaults except where required):
#   OPENVOID_API_URL    Session API base URL (default http://localhost:4000).
#   OPENVOID_TEST_REPO  HTTPS Git URL the platform PAT can write to.
#                       Required — no default; the platform-owned
#                       `git-creds` Secret must have Contents:write
#                       on this repo.
#   BRANCH              Source branch to clone (default `main`).
#
# Preconditions:
#   - `tilt up` has built+pushed the three session-pod images to the
#     kind local registry, and the Session API is Ready.
#   - The three openvoid-sessions Secrets are applied:
#       git-creds, opencode-server-password, opencode-auth.
#     See infra/local/*.yaml.example for the shapes.
#
# Exit codes:
#   0 — happy path (file landed on the feat branch on GitHub).
#   1 — preconditions failed.
#   2 — pod never became Running.
#   3 — agent prompt errored or file missing in the pod.
#   4 — pod did not terminate within the grace window.
#   5 — branch did not land on GitHub.

set -euo pipefail

OPENVOID_API_URL="${OPENVOID_API_URL:-http://localhost:4000}"
BRANCH="${BRANCH:-main}"
NAMESPACE="openvoid-sessions"

if [ -z "${OPENVOID_TEST_REPO:-}" ]; then
  echo "error: OPENVOID_TEST_REPO is required (HTTPS Git URL)" >&2
  exit 1
fi

# --------------------------------------------------------------------
# Preconditions: kind context, Secrets, API reachable.
# --------------------------------------------------------------------

ctx=$(kubectl config current-context 2>/dev/null || true)
if [ "$ctx" != "kind-openvoid-local" ]; then
  echo "error: kubectl context is '$ctx', expected 'kind-openvoid-local'" >&2
  exit 1
fi

for secret in git-creds opencode-server-password opencode-auth; do
  if ! kubectl get secret -n "$NAMESPACE" "$secret" >/dev/null 2>&1; then
    echo "error: Secret '$secret' missing in namespace '$NAMESPACE'" >&2
    echo "       (see infra/local/${secret//-secret/}-secret.yaml.example)" >&2
    exit 1
  fi
done

if ! curl -sf -o /dev/null "$OPENVOID_API_URL/healthz" 2>/dev/null \
   && ! curl -sf -o /dev/null "$OPENVOID_API_URL/" 2>/dev/null; then
  echo "error: Session API not reachable at $OPENVOID_API_URL" >&2
  exit 1
fi

# --------------------------------------------------------------------
# Cleanup trap: shut down port-forward, force-delete a hung pod, drop
# the demo branch on GitHub. Runs on success, failure, or Ctrl-C.
# --------------------------------------------------------------------

PF_PID=""
SID=""
SID_LC=""
DEMO_BRANCH=""
GIT_TOKEN=""
REPO_PATH=""

cleanup() {
  set +e
  if [ -n "$PF_PID" ]; then kill "$PF_PID" 2>/dev/null; fi
  if [ -n "$SID_LC" ]; then
    if kubectl get pod -n "$NAMESPACE" "session-$SID_LC" >/dev/null 2>&1; then
      echo "[cleanup] force-deleting hung pod session-$SID_LC" >&2
      kubectl delete pod -n "$NAMESPACE" "session-$SID_LC" \
        --grace-period=0 --force >/dev/null 2>&1
    fi
  fi
  if [ -n "$DEMO_BRANCH" ] && [ -n "$GIT_TOKEN" ] && [ -n "$REPO_PATH" ]; then
    curl -s -o /dev/null -X DELETE \
      -H "Authorization: Bearer $GIT_TOKEN" \
      "https://api.github.com/repos/$REPO_PATH/git/refs/heads/$DEMO_BRANCH" || true
  fi
}
trap cleanup EXIT

# --------------------------------------------------------------------
# Step 1: POST /sessions — Session API builds the per-session Pod.
# Response carries the upper-cased ULID; the K8s pod name is the
# lower-cased form (`session-<lowercased-id>`) per `client.ts`.
# --------------------------------------------------------------------

echo "==> step 1: POST /sessions"
SID=$(curl -sf -X POST "$OPENVOID_API_URL/sessions" \
  -H 'content-type: application/json' \
  -d "{\"repo\":\"$OPENVOID_TEST_REPO\",\"branch\":\"$BRANCH\"}" \
  | jq -r .sessionId)
SID_LC=$(echo "$SID" | tr '[:upper:]' '[:lower:]')
DEMO_BRANCH="feat/$SID_LC"
echo "    sessionId=$SID  pod=session-$SID_LC"

# --------------------------------------------------------------------
# Step 2: wait for Pod=Running. The init container clones the repo
# and exits; the finalizer sidecar starts; the OpenCode main container
# performs its one-time SQLite migration on first boot (~3-4s) and
# then listens on :8080.
# --------------------------------------------------------------------

echo "==> step 2: waiting for pod to reach Running"
deadline=$(( $(date +%s) + 90 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  phase=$(kubectl get pod -n "$NAMESPACE" "session-$SID_LC" \
    -o jsonpath='{.status.phase}' 2>/dev/null || true)
  if [ "$phase" = "Running" ]; then break; fi
  sleep 2
done
if [ "$phase" != "Running" ]; then
  echo "error: pod did not reach Running within 90s (phase=$phase)" >&2
  exit 2
fi
echo "    Running"

# --------------------------------------------------------------------
# Step 3: port-forward to OpenCode's :8080 and confirm /global/health.
# The HTTP Basic password lives in the opencode-server-password
# Secret; we read it the same way an operator would.
# --------------------------------------------------------------------

echo "==> step 3: health check via port-forward"
PASSWORD=$(kubectl get secret -n "$NAMESPACE" opencode-server-password \
  -o jsonpath='{.data.password}' | base64 -d)
kubectl port-forward -n "$NAMESPACE" "session-$SID_LC" 18080:8080 \
  >/tmp/phase6-demo-pf.log 2>&1 &
PF_PID=$!
sleep 3
HEALTH=$(curl -sf -u "opencode:$PASSWORD" http://localhost:18080/global/health)
echo "    $HEALTH"

# --------------------------------------------------------------------
# Step 4: open an OpenCode session and send a canned write-tool
# prompt. The agent's response includes which tools it called;
# anything other than `error: null` is a wire-up failure.
# --------------------------------------------------------------------

echo "==> step 4: prompt agent to write PHASE6_DEMO.txt"
OS_SID=$(curl -sf -u "opencode:$PASSWORD" -X POST http://localhost:18080/session \
  -H 'content-type: application/json' -d '{}' | jq -r .id)

PROMPT='Use the write tool to create a file at /workspace/repo/PHASE6_DEMO.txt containing the single line: Phase 6 demo from openvoid'
RESP=$(curl -sf -u "opencode:$PASSWORD" -X POST \
  "http://localhost:18080/session/$OS_SID/message" \
  -H 'content-type: application/json' \
  --data-binary "$(jq -nc --arg t "$PROMPT" '{parts:[{type:"text",text:$t}]}')" \
  --max-time 90)

ERR=$(echo "$RESP" | jq -r '.info.error.name // "null"')
MODEL=$(echo "$RESP" | jq -r '.info.modelID')
echo "    model=$MODEL  error=$ERR"
if [ "$ERR" != "null" ]; then
  echo "error: agent prompt returned an error: $ERR" >&2
  echo "$RESP" | jq '.info.error' >&2
  exit 3
fi

# --------------------------------------------------------------------
# Step 5: confirm the file exists in the pod's filesystem before
# tearing down. If it's missing, the agent's tool call failed even
# though the API didn't error — trust verifies more than claim.
# --------------------------------------------------------------------

echo "==> step 5: verify file in pod"
if ! kubectl exec -n "$NAMESPACE" "session-$SID_LC" -c session -- \
       cat /workspace/repo/PHASE6_DEMO.txt 2>/dev/null \
     | grep -q "Phase 6 demo from openvoid"; then
  echo "error: file not found or content mismatch in pod" >&2
  exit 3
fi
echo "    /workspace/repo/PHASE6_DEMO.txt OK"

# Stop the port-forward before DELETE — otherwise it spews errors as
# the pod tears down.
kill "$PF_PID" 2>/dev/null
PF_PID=""

# --------------------------------------------------------------------
# Step 6: DELETE /sessions triggers the SIGTERM cascade. The kubelet
# signals the main container first (OpenCode exits within 1-2 s
# thanks to the entrypoint shell trap), then signals the finalizer
# sidecar (which commits and pushes the agent's edits before
# exiting). Pod removal in <10 s is the load-bearing signal — if it
# stays in Terminating for 180 s, the SIGTERM cascade is broken.
# --------------------------------------------------------------------

echo "==> step 6: DELETE /sessions/$SID"
curl -sf -o /dev/null -X DELETE "$OPENVOID_API_URL/sessions/$SID"

echo "==> step 7: waiting for pod terminate"
START=$(date +%s)
deadline=$(( START + 60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if ! kubectl get pod -n "$NAMESPACE" "session-$SID_LC" >/dev/null 2>&1; then
    echo "    pod gone after $(( $(date +%s) - START ))s"
    break
  fi
  sleep 2
done
if kubectl get pod -n "$NAMESPACE" "session-$SID_LC" >/dev/null 2>&1; then
  echo "error: pod still present after 60 s — SIGTERM cascade may be broken" >&2
  exit 4
fi

# --------------------------------------------------------------------
# Step 8: GitHub round-trip — read the platform PAT from the
# git-creds Secret and confirm `feat/<sid>` exists with the agent's
# file. The cleanup trap drops the demo branch on exit.
# --------------------------------------------------------------------

echo "==> step 8: verify branch on GitHub"
GIT_TOKEN=$(kubectl get secret -n "$NAMESPACE" git-creds \
  -o jsonpath='{.data.token}' | base64 -d)
# Strip the optional `.git` suffix and any trailing slash so the GH
# API path is clean.
REPO_PATH=$(printf '%s' "$OPENVOID_TEST_REPO" \
  | sed -E 's#^https?://github\.com/##; s#\.git$##; s#/$##')

CODE=$(curl -s -o /tmp/phase6-demo-branch.json -w '%{http_code}' \
  -H "Authorization: Bearer $GIT_TOKEN" \
  "https://api.github.com/repos/$REPO_PATH/branches/$DEMO_BRANCH")
if [ "$CODE" != "200" ]; then
  echo "error: GitHub returned $CODE for branch $DEMO_BRANCH" >&2
  exit 5
fi
SHA=$(jq -r .commit.sha < /tmp/phase6-demo-branch.json)
echo "    https://github.com/$REPO_PATH/tree/$DEMO_BRANCH  ($SHA)"

CONTENT=$(curl -sf -H "Authorization: Bearer $GIT_TOKEN" \
  "https://api.github.com/repos/$REPO_PATH/contents/PHASE6_DEMO.txt?ref=$DEMO_BRANCH" \
  | jq -r .content | base64 -d)
echo "    file content: $(echo "$CONTENT" | head -1)"

echo
echo "OK — Phase 6 demo passed end-to-end."
