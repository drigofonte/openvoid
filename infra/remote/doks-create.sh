#!/usr/bin/env bash
# Create the openvoid DOKS cluster for v1 demos.
#
# Sizing decisions (see plan + brainstorm):
#   - 1× s-2vcpu-4gb node (~$24/mo while running)
#   - autoscale OFF (predictable cost)
#   - HA control plane OFF (free; HA is +$40/mo and v1 doesn't need 99.95% SLA)
#   - region defaults to nyc1; override via OPENVOID_DO_REGION
#
# To upgrade for multi-user demos: edit `--node-pool` to size=s-2vcpu-8gb
# (~$48/mo) before running. See README.md for capacity math.
#
# Idempotent only in the negative direction — `doctl ... cluster create`
# fails loudly if the cluster already exists. Run doks-destroy.sh first.
#
# After create, --update-kubeconfig and --set-current-context default to
# true, so the implementer's kubectl context switches automatically.

set -euo pipefail

CLUSTER_NAME="${OPENVOID_DO_CLUSTER:-openvoid-dev}"
REGION="${OPENVOID_DO_REGION:-nyc1}"
NODE_SIZE="${OPENVOID_DO_NODE_SIZE:-s-2vcpu-4gb}"
NODE_COUNT="${OPENVOID_DO_NODE_COUNT:-1}"
K8S_VERSION="${OPENVOID_DO_K8S_VERSION:-latest}"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${RESET} %s\n" "$1"; }

step "Preflight"
command -v doctl >/dev/null || { echo "doctl not found; brew install doctl."; exit 1; }
doctl auth list >/dev/null 2>&1 || { echo "doctl is not authenticated; run \`doctl auth init\`."; exit 1; }
ok "doctl ready"

# Refuse to recreate an existing cluster — guards against accidental
# spend if the destroy script wasn't run between sessions.
if doctl kubernetes cluster get "${CLUSTER_NAME}" >/dev/null 2>&1; then
  warn "cluster '${CLUSTER_NAME}' already exists"
  printf "    To recreate, run: ${BOLD}bash $(dirname "$0")/doks-destroy.sh${RESET} first.\n"
  printf "    To use the existing cluster, run: ${BOLD}doctl kubernetes cluster kubeconfig save ${CLUSTER_NAME}${RESET}\n"
  exit 1
fi

step "Creating DOKS cluster: ${CLUSTER_NAME} (${NODE_COUNT}× ${NODE_SIZE}, ${REGION}, k8s=${K8S_VERSION})"
printf "  ${YELLOW}!${RESET} this will take ~5 minutes and start billing immediately.\n"
printf "  ${YELLOW}!${RESET} cost: ~\$24/mo per node while running. ${BOLD}Run doks-destroy.sh between work sessions.${RESET}\n"
echo

# Note: omitting any auto-scale fields — without --auto-scale (top-level)
# the pool stays fixed-size at NODE_COUNT, which is what we want.
doctl kubernetes cluster create "${CLUSTER_NAME}" \
  --region "${REGION}" \
  --version "${K8S_VERSION}" \
  --node-pool "name=pool-a;size=${NODE_SIZE};count=${NODE_COUNT}"

step "Done"
ok "kubeconfig saved and context activated"
printf "  context: ${BOLD}$(kubectl config current-context)${RESET}\n"
printf "  next:    ${BOLD}kubectl get nodes${RESET}\n"
printf "  destroy: ${BOLD}bash $(dirname "$0")/doks-destroy.sh${RESET}\n"
