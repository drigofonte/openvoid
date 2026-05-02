#!/usr/bin/env bash
# Tear down the local kind cluster + the registry container.
# Idempotent: missing pieces are silently skipped.

set -euo pipefail

CLUSTER_NAME="openvoid-local"
REG_NAME="kind-registry"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
note() { printf "  ${YELLOW}…${RESET} %s\n" "$1"; }

step "Cluster"
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  kind delete cluster --name "${CLUSTER_NAME}"
  ok "deleted ${CLUSTER_NAME}"
else
  note "no kind cluster named ${CLUSTER_NAME}"
fi

step "Registry"
if docker ps -a --format '{{.Names}}' | grep -q "^${REG_NAME}$"; then
  docker rm -f "${REG_NAME}" >/dev/null
  ok "removed ${REG_NAME}"
else
  note "no registry container named ${REG_NAME}"
fi

echo
printf "${GREEN}${BOLD}torn down.${RESET}\n"
