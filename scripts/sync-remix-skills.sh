#!/usr/bin/env bash
# Sync Remix dev skills from the upstream remix-run/remix repo into
# this repo's `.claude/skills/` directory. Run any time we want to
# bump the pinned upstream SHA — bumps are deliberate, not automatic.
#
# What gets installed (for app consumers — the Remix-internal
# contributor skills like make-pr, supersede-pr, etc. are skipped):
#
#   - expert-typescript-programmer  — TS correctness, strict types,
#                                     no `any`, precise generics.
#   - write-tests                   — `remix/test` patterns, fixtures,
#                                     mocks, package-test conventions.
#   - author-ui-modules             — `packages/ui`-style mixin,
#                                     plain-context, handle.context
#                                     idioms. Applies to authoring our
#                                     own `clientEntry` components.
#
# After running, anyone opening this repo with Claude Code can invoke
# the skills via `/skill <name>` for framework-shaped guidance.
#
# To bump the pin, update PINNED_SHA below and re-run. Verify the
# diffs before committing — Remix 3 is in beta and skill prose may
# rename APIs as the framework evolves.

set -euo pipefail

PINNED_SHA="823e48cb9c8fff787a4d951a380ae42f1672e718"
REPO="remix-run/remix"
SKILLS=(expert-typescript-programmer write-tests author-ui-modules)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_ROOT="$REPO_ROOT/.claude/skills"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; BLUE=''; BOLD=''; RESET=''
fi

step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }

command -v gh >/dev/null || { echo "gh CLI is required (brew install gh)"; exit 1; }

step "Syncing Remix dev skills @ ${PINNED_SHA:0:12}"

mkdir -p "$SKILLS_ROOT"

for name in "${SKILLS[@]}"; do
  dest_dir="$SKILLS_ROOT/$name"
  dest_file="$dest_dir/SKILL.md"
  mkdir -p "$dest_dir"
  gh api "repos/$REPO/contents/.agents/skills/$name/SKILL.md?ref=$PINNED_SHA" \
    --jq '.content' \
    | base64 -d > "$dest_file"
  ok "$name"
done

step "Verifying frontmatter"
for name in "${SKILLS[@]}"; do
  dest_file="$SKILLS_ROOT/$name/SKILL.md"
  if ! head -n 4 "$dest_file" | grep -q '^name: '; then
    echo "  ✗ $name: missing 'name:' in frontmatter"
    exit 1
  fi
  if ! head -n 4 "$dest_file" | grep -q '^description: '; then
    echo "  ✗ $name: missing 'description:' in frontmatter"
    exit 1
  fi
  ok "$name has valid frontmatter"
done

echo
printf "${GREEN}${BOLD}done.${RESET} Skills installed at ${BOLD}.claude/skills/${RESET}\n"
printf "Pinned to ${BOLD}%s@%s${RESET}.\n" "$REPO" "${PINNED_SHA:0:12}"
