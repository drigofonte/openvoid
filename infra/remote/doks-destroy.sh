#!/usr/bin/env bash
# Destroy the openvoid DOKS cluster.
# Idempotent: missing cluster is a no-op with a friendly note.
#
# Cluster billing stops immediately on delete. Detached PVCs/LBs created
# by the cluster are cleaned up automatically by DigitalOcean — but
# verify in the DO control panel after first run, since these are billed
# resources that survive cluster deletion if not properly garbage-collected.

set -euo pipefail

CLUSTER_NAME="${OPENVOID_DO_CLUSTER:-openvoid-dev}"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
note() { printf "  ${YELLOW}…${RESET} %s\n" "$1"; }

command -v doctl >/dev/null || { echo "doctl not found."; exit 1; }

step "Cluster"
if doctl kubernetes cluster get "${CLUSTER_NAME}" >/dev/null 2>&1; then
  doctl kubernetes cluster delete "${CLUSTER_NAME}" --force --dangerous
  ok "deleted ${CLUSTER_NAME}"
else
  note "no DOKS cluster named ${CLUSTER_NAME}"
fi

step "Reminder"
printf "  ${YELLOW}!${RESET} Confirm in the DO control panel that no orphaned LoadBalancers or\n"
printf "    Block Storage volumes survive — those are billed independently.\n"
printf "    LBs:     ${BOLD}doctl compute load-balancer list${RESET}\n"
printf "    Volumes: ${BOLD}doctl compute volume list${RESET}\n"
