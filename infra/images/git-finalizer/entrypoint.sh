#!/bin/sh
# git-finalizer — native sidecar entrypoint.
#
# Idles until SIGTERM, then commits any edits in /workspace/repo and pushes
# them to feat/<sessionId> using the platform PAT mounted via $GIT_TOKEN.
#
# The native-sidecar pattern (initContainer + restartPolicy: Always) means
# this container runs alongside the main container; on Pod termination, the
# kubelet sends SIGTERM to the main first, waits for it to exit, then sends
# SIGTERM to this sidecar. The trap below performs the final push during
# that window (sized by terminationGracePeriodSeconds).
#
# Requires (env):
#   HOSTNAME    — the Pod hostname; format `session-<sessionId-lowercased>`
#   BRANCH      — original repo default branch (used as commit message context)
#   GIT_TOKEN   — platform PAT, projected from the `git-creds` Secret
#
# Mount paths:
#   /workspace        — shared with git-clone (init) + main, repo at /workspace/repo
#   /etc/git-creds    — defense-in-depth file mount of the same Secret (read-only)

set -u

REPO_DIR="/workspace/repo"

session_id() {
  printf '%s' "${HOSTNAME}" | sed 's/^session-//'
}

try_push() {
  # --force-with-lease is the safety net against losing concurrent updates:
  # if the remote branch advanced unexpectedly, the push fails rather than
  # overwriting. For first-pushes (the common case) it's equivalent to a
  # normal push; for retries after a partial earlier push, it converges.
  git push --force-with-lease "$1" "HEAD:$2"
}

finalize() {
  echo "[finalizer] SIGTERM received; running finalize()" >&2
  cd "${REPO_DIR}" 2>/dev/null || {
    echo "[finalizer] ${REPO_DIR} is missing; nothing to push" >&2
    exit 0
  }

  git add -A
  if git diff --cached --quiet; then
    echo "[finalizer] nothing to commit; not pushing (no branch created)" >&2
    return 0
  fi
  git commit -m "session $(hostname) $(date -Iseconds)" || true

  origin=$(git remote get-url origin)
  auth_url=$(printf '%s' "${origin}" | sed -e "s#^https://#https://x-access-token:${GIT_TOKEN}@#")
  branch="feat/$(session_id)"

  echo "[finalizer] pushing HEAD to ${branch}" >&2
  if try_push "${auth_url}" "${branch}"; then
    echo "[finalizer] push succeeded" >&2
    return 0
  fi

  # Single retry with exponential backoff (1s, then 4s) handles transient
  # network blips. Non-transient failures (auth, branch protection) will
  # fail twice and exit non-zero — that's the right outcome.
  for delay in 1 4; do
    echo "[finalizer] push failed; retrying in ${delay}s" >&2
    sleep "${delay}"
    if try_push "${auth_url}" "${branch}"; then
      echo "[finalizer] push succeeded on retry" >&2
      return 0
    fi
  done

  echo "[finalizer] push failed after retries; giving up" >&2
  return 1
}

trap 'finalize; exit 0' TERM INT

echo "[finalizer] idle; waiting for SIGTERM" >&2
# `& wait $!` is load-bearing — without it, sleep blocks signal delivery.
while true; do
  sleep 3600 &
  wait $!
done
