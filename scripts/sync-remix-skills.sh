#!/usr/bin/env bash
# Sync the Remix dev skill from the upstream remix-run/remix repo into
# this repo's `.claude/skills/` directory. Run any time we want to
# bump the pinned upstream SHA — bumps are deliberate, not automatic.
#
# What gets installed:
#
#   .claude/skills/remix/
#     ├── SKILL.md       — the entry-point skill description
#     └── references/    — 11 deep-dive reference docs:
#         ├── routing-and-controllers.md
#         ├── middleware-and-server.md
#         ├── assets-and-browser-modules.md
#         ├── data-and-validation.md
#         ├── auth-and-sessions.md
#         ├── component-model.md
#         ├── mixins-styling-events.md
#         ├── create-mixins.md
#         ├── animate-elements.md
#         ├── hydration-frames-navigation.md
#         └── testing-patterns.md
#
# This is the remix-run/remix `template/.agents/skills/remix/` bundle —
# the skill the Remix team ships for app builders (not the
# contributor-workflow skills under `.agents/skills/`).
#
# After running, anyone opening this repo with Claude Code can invoke
# `/skill remix` for framework-shaped guidance.
#
# To bump the pin, update PINNED_SHA below and re-run. Verify the
# diffs before committing — Remix 3 is in beta and skill prose may
# rename APIs as the framework evolves.

set -euo pipefail

PINNED_SHA="823e48cb9c8fff787a4d951a380ae42f1672e718"
REPO="remix-run/remix"
UPSTREAM_PATH="template/.agents/skills/remix"
SKILL_NAME="remix"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_DIR="$REPO_ROOT/.claude/skills/$SKILL_NAME"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; BLUE=''; BOLD=''; RESET=''
fi

step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }

command -v gh >/dev/null || { echo "gh CLI is required (brew install gh)"; exit 1; }
command -v jq >/dev/null || { echo "jq is required (brew install jq)"; exit 1; }

step "Syncing Remix skill @ ${PINNED_SHA:0:12}"

# Stage to a temp dir first so a mid-fetch failure leaves the live
# .claude/skills/ untouched. Atomic-ish swap at the end.
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
mkdir -p "$STAGE_DIR/references"

fetch_file() {
  local upstream_path="$1"
  local dest_file="$2"
  local response
  response="$(gh api "repos/$REPO/contents/$upstream_path?ref=$PINNED_SHA")"
  local content
  content="$(printf '%s' "$response" | jq -er '.content')" || {
    echo "  ✗ $upstream_path: gh api returned no .content (likely 404)" >&2
    exit 1
  }
  printf '%s' "$content" | base64 -d > "$dest_file"
  if [ ! -s "$dest_file" ]; then
    echo "  ✗ $upstream_path: decoded file is empty" >&2
    exit 1
  fi
}

# Top-level SKILL.md
fetch_file "$UPSTREAM_PATH/SKILL.md" "$STAGE_DIR/SKILL.md"
ok "SKILL.md"

# Discover and fetch every reference file under references/.
references_json="$(gh api "repos/$REPO/contents/$UPSTREAM_PATH/references?ref=$PINNED_SHA")"
ref_count=0
while IFS= read -r ref_name; do
  fetch_file "$UPSTREAM_PATH/references/$ref_name" "$STAGE_DIR/references/$ref_name"
  ok "references/$ref_name"
  ref_count=$((ref_count + 1))
done < <(printf '%s' "$references_json" | jq -r '.[] | select(.type == "file") | .name')

step "Verifying frontmatter"
if ! head -n 4 "$STAGE_DIR/SKILL.md" | grep -q '^name: '; then
  echo "  ✗ SKILL.md missing 'name:' in frontmatter" >&2
  exit 1
fi
if ! head -n 4 "$STAGE_DIR/SKILL.md" | grep -q '^description: '; then
  echo "  ✗ SKILL.md missing 'description:' in frontmatter" >&2
  exit 1
fi
ok "SKILL.md frontmatter valid"

step "Installing"
rm -rf "$SKILL_DIR"
mkdir -p "$(dirname "$SKILL_DIR")"
mv "$STAGE_DIR" "$SKILL_DIR"
trap - EXIT  # STAGE_DIR has been renamed; no need to clean up
ok "$SKILL_DIR populated"

echo
printf "${GREEN}${BOLD}done.${RESET} Skill installed at ${BOLD}.claude/skills/$SKILL_NAME/${RESET}\n"
printf "  - SKILL.md\n"
printf "  - references/ (%d file(s))\n" "$ref_count"
printf "Pinned to ${BOLD}%s@%s${RESET}.\n" "$REPO" "${PINNED_SHA:0:12}"
