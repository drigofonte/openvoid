#!/usr/bin/env bash
# Bring up a local kind cluster wired to a local Docker registry.
#
# Idempotent: re-running is safe.
#   - If the registry container already runs at localhost:5001, reuse it.
#   - If the kind cluster already exists, leave it alone.
#   - The registry-network connection is reapplied so a recreated kind
#     cluster picks up the existing registry.
#
# Verifies its work before exiting:
#   - kubectl --context kind-openvoid-local get nodes returns Ready
#   - localhost:5001 responds to /v2/_catalog
#
# Pattern: https://kind.sigs.k8s.io/docs/user/local-registry/

set -euo pipefail

CLUSTER_NAME="openvoid-local"
KIND_CONFIG="$(dirname "$0")/../infra/local/kind-cluster.yaml"
REG_NAME="kind-registry"
REG_PORT="5001"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- formatting ----
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
note() { printf "  ${YELLOW}…${RESET} %s\n" "$1"; }

# ---- preflight ----

step "Preflight"
command -v docker >/dev/null || { echo "docker not found; install Docker Desktop or colima."; exit 1; }
command -v kind >/dev/null   || { echo "kind not found; brew install kind."; exit 1; }
command -v kubectl >/dev/null|| { echo "kubectl not found; brew install kubectl."; exit 1; }
docker info >/dev/null 2>&1  || { echo "docker daemon not reachable."; exit 1; }
ok "tooling present"

# ---- registry container ----

step "Local registry container"
if [ "$(docker inspect -f '{{.State.Running}}' "${REG_NAME}" 2>/dev/null || true)" = "true" ]; then
  note "${REG_NAME} already running on :${REG_PORT}"
else
  docker run -d --restart=always \
    -p "127.0.0.1:${REG_PORT}:5000" \
    --network bridge \
    --name "${REG_NAME}" \
    registry:2 >/dev/null
  ok "started ${REG_NAME} on 127.0.0.1:${REG_PORT}"
fi

# ---- kind cluster ----

step "kind cluster"
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  note "cluster ${CLUSTER_NAME} already exists"
else
  kind create cluster --config "${KIND_CONFIG}"
  ok "created cluster ${CLUSTER_NAME}"
fi

# ---- per-node containerd hosts.toml for the local registry ----
# Each kind node has /etc/containerd/certs.d configured (per kind-cluster.yaml).
# We write a hosts.toml entry telling containerd to resolve
# `localhost:${REG_PORT}` to the in-network registry container.

step "Wiring registry into nodes"
REGISTRY_DIR="/etc/containerd/certs.d/localhost:${REG_PORT}"
for node in $(kind get nodes --name "${CLUSTER_NAME}"); do
  docker exec "${node}" mkdir -p "${REGISTRY_DIR}"
  cat <<EOF | docker exec -i "${node}" cp /dev/stdin "${REGISTRY_DIR}/hosts.toml"
[host."http://${REG_NAME}:5000"]
EOF
done
ok "containerd hosts.toml in place on all nodes"

# ---- connect registry to the kind network ----

step "Network: registry ↔ kind"
if [ "$(docker inspect -f='{{json .NetworkSettings.Networks.kind}}' "${REG_NAME}" 2>/dev/null)" = "null" ]; then
  docker network connect "kind" "${REG_NAME}"
  ok "connected ${REG_NAME} to kind network"
else
  note "${REG_NAME} already on kind network"
fi

# ---- ConfigMap so KEP-1755 tooling discovers the registry ----

step "Registry-hosting ConfigMap"
cat <<EOF | kubectl --context "kind-${CLUSTER_NAME}" apply -f - >/dev/null
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "localhost:${REG_PORT}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF
ok "kube-public/local-registry-hosting applied"

# ---- verify ----

step "Verify"
kubectl --context "kind-${CLUSTER_NAME}" wait --for=condition=Ready node --all --timeout=60s >/dev/null
ok "all nodes Ready"

if curl -fsS "http://localhost:${REG_PORT}/v2/_catalog" >/dev/null 2>&1; then
  ok "registry reachable at http://localhost:${REG_PORT}"
else
  echo "registry did not respond at http://localhost:${REG_PORT}/v2/_catalog"
  exit 1
fi

echo
printf "${GREEN}${BOLD}kind cluster ready.${RESET}\n"
printf "  context:  ${BOLD}kind-${CLUSTER_NAME}${RESET}\n"
printf "  registry: ${BOLD}localhost:${REG_PORT}${RESET}\n"
printf "  next:     ${BOLD}kubectl get pods -A${RESET}  (or  ${BOLD}bash scripts/kind-down.sh${RESET}  to tear down)\n"
