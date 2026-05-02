#!/usr/bin/env bash
# Verifies the local toolchain meets openvoid's minimum versions.
# Exits 0 if all required tools are present at supported versions.
# Exits 1 if any required tool is missing or below floor.
# Optional/recommended tools produce informational warnings only.

set -u

# ---- formatting ----
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# ---- helpers ----

# Compare semver-ish strings: returns 0 if $1 >= $2, 1 otherwise.
# Handles plain numeric MAJOR.MINOR.PATCH; ignores trailing -prerelease/+build.
version_ge() {
  local have="${1%%-*}"; have="${have%%+*}"
  local want="${2%%-*}"; want="${want%%+*}"
  # Pad to 3 components.
  local h_major h_minor h_patch w_major w_minor w_patch
  IFS='.' read -r h_major h_minor h_patch <<< "${have}"
  IFS='.' read -r w_major w_minor w_patch <<< "${want}"
  h_major=${h_major:-0}; h_minor=${h_minor:-0}; h_patch=${h_patch:-0}
  w_major=${w_major:-0}; w_minor=${w_minor:-0}; w_patch=${w_patch:-0}
  if   [ "${h_major}" -gt "${w_major}" ]; then return 0
  elif [ "${h_major}" -lt "${w_major}" ]; then return 1
  elif [ "${h_minor}" -gt "${w_minor}" ]; then return 0
  elif [ "${h_minor}" -lt "${w_minor}" ]; then return 1
  elif [ "${h_patch}" -ge "${w_patch}" ]; then return 0
  else return 1
  fi
}

# Extract a MAJOR.MINOR.PATCH-ish substring from arbitrary version output.
extract_version() {
  echo "$1" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n1
}

check_required() {
  local name="$1" cmd="$2" min_version="$3" version_args="$4" install_hint="${5:-}"

  if ! command -v "${cmd}" >/dev/null 2>&1; then
    printf "  ${RED}✗${RESET} %-14s %s\n" "${name}" "not installed"
    if [ -n "${install_hint}" ]; then
      printf "    ${BLUE}→${RESET} %s\n" "${install_hint}"
    fi
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  local raw_output
  raw_output="$(${cmd} ${version_args} 2>&1 | head -n5)" || true
  local found_version
  found_version="$(extract_version "${raw_output}")"

  if [ -z "${found_version}" ]; then
    printf "  ${YELLOW}?${RESET} %-14s installed (could not parse version: %s)\n" "${name}" "$(echo "${raw_output}" | head -n1)"
    PASS_COUNT=$((PASS_COUNT + 1))
    return
  fi

  if version_ge "${found_version}" "${min_version}"; then
    printf "  ${GREEN}✓${RESET} %-14s %s (≥ %s required)\n" "${name}" "${found_version}" "${min_version}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf "  ${RED}✗${RESET} %-14s %s (need ≥ %s)\n" "${name}" "${found_version}" "${min_version}"
    if [ -n "${install_hint}" ]; then
      printf "    ${BLUE}→${RESET} %s\n" "${install_hint}"
    fi
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

check_optional() {
  local name="$1" cmd="$2" purpose="$3"
  if command -v "${cmd}" >/dev/null 2>&1; then
    printf "  ${GREEN}✓${RESET} %-14s installed (%s)\n" "${name}" "${purpose}"
  else
    printf "  ${YELLOW}○${RESET} %-14s not installed — optional (%s)\n" "${name}" "${purpose}"
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
}

check_docker_running() {
  if ! command -v docker >/dev/null 2>&1; then
    printf "  ${RED}✗${RESET} %-14s not installed\n" "docker"
    printf "    ${BLUE}→${RESET} Install Docker Desktop (mac), colima, or docker.io (linux).\n"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi
  if docker info >/dev/null 2>&1; then
    local docker_version
    docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'unknown')"
    printf "  ${GREEN}✓${RESET} %-14s daemon running (server %s)\n" "docker" "${docker_version}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf "  ${RED}✗${RESET} %-14s installed but daemon not reachable\n" "docker"
    printf "    ${BLUE}→${RESET} Start Docker Desktop, run \`colima start\`, or \`sudo systemctl start docker\`.\n"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# ---- run ----

printf "${BOLD}openvoid toolchain check${RESET}\n\n"

printf "${BOLD}Required (every phase)${RESET}\n"
check_docker_running
check_required "kubectl"     "kubectl"      "1.30.0"  "version --client" "brew install kubectl"
check_required "kind"        "kind"         "0.27.0"  "--version"        "brew install kind"
check_required "tilt"        "tilt"         "0.33.0"  "version"          "brew install tilt-dev/tap/tilt"
check_required "node"        "node"         "20.0.0"  "--version"        "brew install node@20"
check_required "pnpm"        "pnpm"         "9.0.0"   "--version"        "corepack enable && corepack prepare pnpm@latest --activate"
check_required "go"          "go"           "1.22.0"  "version"          "brew install go"

echo
printf "${BOLD}Required from Phase 4 onward${RESET}\n"
check_required "kubebuilder" "kubebuilder"  "4.14.0"  "version"          "https://book.kubebuilder.io/quick-start#installation"
check_required "ko"          "ko"           "0.16.0"  "version"          "brew install ko"

echo
printf "${BOLD}Required for DOKS demos (Phase 1.2+, Phase 9+)${RESET}\n"
check_required "doctl"       "doctl"        "1.110.0" "version"          "brew install doctl"
check_required "helm"        "helm"         "3.16.0"  "version --short"  "brew install helm"
check_required "cloudflared" "cloudflared"  "2024.10.0" "--version"      "brew install cloudflared"

echo
printf "${BOLD}Recommended ergonomics (optional)${RESET}\n"
check_optional "kubectx"     "kubectx"      "fast context switching"
check_optional "kubens"      "kubens"       "fast namespace switching"
check_optional "stern"       "stern"        "tail logs across many pods"
check_optional "k9s"         "k9s"          "TUI dashboard for clusters"

echo
printf "${BOLD}Summary${RESET}\n"
printf "  ${GREEN}%d passed${RESET}" "${PASS_COUNT}"
if [ "${WARN_COUNT}" -gt 0 ]; then
  printf "    ${YELLOW}%d optional missing${RESET}" "${WARN_COUNT}"
fi
if [ "${FAIL_COUNT}" -gt 0 ]; then
  printf "    ${RED}%d required missing or below floor${RESET}\n\n" "${FAIL_COUNT}"
  printf "${RED}${BOLD}Fix the failures above before proceeding.${RESET}\n"
  exit 1
fi
printf "\n\n${GREEN}${BOLD}All required tools are ready.${RESET}\n"
exit 0
