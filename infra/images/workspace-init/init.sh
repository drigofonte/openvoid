#!/bin/sh
# workspace-init — initContainer entrypoint.
#
# Two boot paths driven by env. When OPENVOID_NEW_APP=true the script
# seeds a fresh per-app repo from the platform scaffold template,
# pushes the seed commit, and runs `pnpm install`. Otherwise it falls
# back to the import-repo path: clone the user-supplied repo at the
# requested branch, strip the token from the persisted remote.
#
# Either path exits 0 on success; non-zero exits surface as
# Init:Error on the Pod and the Session API maps that to
# `status: Failed, error.code: init_failed`.
#
# Common env:
#   REPO_URL    — HTTPS git URL (validated upstream by the Session API).
#                 In new-app mode, points at the freshly-created
#                 per-app repo on the platform org.
#   GIT_TOKEN   — PAT projected from a Secret. Import-repo pods mount
#                 git-creds (user-side); new-app pods mount
#                 github-platform-creds (platform org). Either way the
#                 env name is GIT_TOKEN; the script doesn't care which
#                 Secret it came from.
#
# Import-repo only:
#   BRANCH      — branch to check out.
#
# New-app only:
#   OPENVOID_NEW_APP        — when "true", take run_new_app().
#   SCAFFOLD_TEMPLATE_URL   — anonymous HTTPS URL of the scaffold
#                             template repo; pulled without creds.
#   SCAFFOLD_PROMPT         — free-form user prompt; written into
#                             app/scaffold-meta.json.
#
# Mount paths:
#   /workspace  — shared with the git-finalizer sidecar + the main
#                 container; the populated repo lands at /workspace/repo.

set -eu

REPO_DIR="/workspace/repo"
GIT_USER_EMAIL="openvoid-bot@openvoid.dev"
GIT_USER_NAME="openvoid scaffold"
SCAFFOLD_VERSION="v1"

# Strip leading https:// and return host+path; used by both code paths
# to assemble the credential-injected push URL without ever embedding
# the token in `git remote set-url`.
host_and_path() {
  printf '%s' "$1" | sed -E 's#^https?://##'
}

apply_group_writable_perms() {
  # Make the repo writable by the pod's fsGroup. git creates files
  # with 755/644 perms (user-only write), but fsGroup only sets the
  # GID — it doesn't grant group-write recursively. Without this, the
  # agent main container (running as a non-root UID with fsGroup as a
  # supplementary group) can read but not edit the cloned files. The
  # setgid bit on directories ensures any new files the agent creates
  # inherit the same group, so the finalizer sidecar can read them
  # too.
  chmod -R g+w "$REPO_DIR"
  find "$REPO_DIR" -type d -exec chmod g+s {} +
}

run_import_repo() {
  hp=$(host_and_path "$REPO_URL")
  auth_url="https://x-access-token:${GIT_TOKEN}@${hp}"

  git clone --branch "$BRANCH" "$auth_url" "$REPO_DIR"
  git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
  git -C "$REPO_DIR" config user.email "agent@openvoid.local"
  git -C "$REPO_DIR" config user.name "openvoid agent"

  apply_group_writable_perms
}

# Write app/scaffold-meta.json without jq (node:22-alpine ships node
# but not jq, and we don't want a node script just for one JSON
# write). The prompt value goes through a small escape pass because
# it can contain ", \, and newlines.
write_scaffold_meta() {
  meta_path="$REPO_DIR/app/scaffold-meta.json"
  mkdir -p "$(dirname "$meta_path")"
  created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  # Backslash + double-quote escaping, then turn raw newlines into
  # the two-char JSON sequence \n so the printf below stays single
  # line.
  escaped_prompt=$(printf '%s' "${SCAFFOLD_PROMPT:-}" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | awk 'BEGIN{ORS=""} { if (NR>1) print "\\n"; print }')
  printf '{\n  "prompt": "%s",\n  "createdAt": "%s",\n  "scaffoldVersion": "%s"\n}\n' \
    "$escaped_prompt" "$created_at" "$SCAFFOLD_VERSION" >"$meta_path"
}

run_new_app() {
  # 1. Anonymous clone of the public scaffold template. No creds
  # needed; SCAFFOLD_TEMPLATE_URL is a public repo on the platform
  # org. Using a token here would either fail (scaffold is in a
  # different org from the PAT's scope) or waste a rate-limit slot.
  git clone "$SCAFFOLD_TEMPLATE_URL" "$REPO_DIR"

  # 2. Strip the scaffold's history so the per-app repo starts with
  # exactly one initial commit. Operators bumping the scaffold over
  # time don't retroactively rewrite existing apps.
  rm -rf "$REPO_DIR/.git"

  # 3-4. Re-initialise against the per-app repo on the platform org.
  cd "$REPO_DIR"
  git init -q -b main
  git remote add origin "$REPO_URL"
  git config user.email "$GIT_USER_EMAIL"
  git config user.name "$GIT_USER_NAME"

  # 5. Overwrite the committed placeholder scaffold-meta.json with
  # the real prompt + timestamp. See docs/scaffolds/react-rr7-minimum.md
  # for the file contract.
  write_scaffold_meta

  # 7. Single seed commit.
  git add -A
  git commit -q -m "Initial commit from scaffold-react-rr7"

  # 8. Push via token-injected URL. `set -x` is never enabled, so the
  # token doesn't appear in logs; the remote stays clean because we
  # never `remote set-url` to the auth_url form. `-u` is deliberately
  # omitted — git's "branch '<branch>' set up to track '<upstream>'"
  # auto-print would expose the full auth_url (token included) to
  # container stdout, which lands in `kubectl logs`. The seed push
  # is the only push this container ever makes; the agent and
  # git-finalizer both re-derive auth from REPO_URL + GIT_TOKEN, so
  # the absence of upstream tracking here is harmless.
  hp=$(host_and_path "$REPO_URL")
  auth_url="https://x-access-token:${GIT_TOKEN}@${hp}"
  git push "$auth_url" main

  # 9. Pre-install deps so the agent container's `pnpm dev` boots
  # without paying the install cost on first request. Running pnpm
  # install in workspace-init (vs. baking node_modules into a
  # scaffold image) is the v1 trade-off — see origin R7.
  pnpm install --frozen-lockfile

  # 10. Group-writable perms for the agent's fsGroup.
  apply_group_writable_perms
}

if [ "${OPENVOID_NEW_APP:-}" = "true" ]; then
  run_new_app
else
  run_import_repo
fi
