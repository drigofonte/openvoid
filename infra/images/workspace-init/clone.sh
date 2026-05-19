#!/bin/sh
# workspace-init — initContainer entrypoint.
#
# Clones the user-specified repo into /workspace/repo using the platform PAT,
# then strips the token from the on-disk remote URL so it never lands in
# `.git/config`. Runs once at Pod startup; exits 0 on success.
#
# Requires (env):
#   REPO_URL    — HTTPS git URL (validated upstream by the Session API).
#   BRANCH      — branch to check out.
#   GIT_TOKEN   — platform PAT, projected from the `git-creds` Secret.
#
# Mount paths:
#   /workspace  — shared with the git-finalizer sidecar + the main container;
#                 the cloned repo lands at /workspace/repo.

set -eu

host_and_path=$(printf '%s' "$REPO_URL" | sed -E 's#^https?://##')
auth_url="https://x-access-token:${GIT_TOKEN}@${host_and_path}"

git clone --branch "$BRANCH" "$auth_url" /workspace/repo
git -C /workspace/repo remote set-url origin "$REPO_URL"
git -C /workspace/repo config user.email "agent@openvoid.local"
git -C /workspace/repo config user.name "openvoid agent"

# Make the repo writable by the pod's fsGroup. git creates files with
# 755/644 perms (user-only write), but fsGroup only sets the GID — it
# doesn't grant group-write recursively. Without this, the agent main
# container (running as a non-root UID with fsGroup as a supplementary
# group) can read but not edit the cloned files. The setgid bit on
# directories ensures any new files the agent creates inherit the same
# group, so the finalizer sidecar can read them too.
chmod -R g+w /workspace/repo
find /workspace/repo -type d -exec chmod g+s {} +
