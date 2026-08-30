#!/usr/bin/env bash
# Prove the cluster's CNI actually enforces NetworkPolicy.
#
# This matters because the failure mode is silent. kindnet, kind's default CNI,
# accepts NetworkPolicy objects and ignores them — so an isolation test can pass
# while the policy does nothing. The app data plane relies on NetworkPolicy to
# keep one app's session pod off another app's database
# (docs/plans/2026-08-29-001-...-plan.md U4), which is untestable locally
# without this guarantee.
#
# Three phases, because "nothing can reach anything" is not enforcement:
#   1. baseline  — client reaches server with no policy in place
#   2. deny      — policy applied, client is blocked
#   3. allow     — client relabelled to match the policy, reaches server again
#
# Exits non-zero if any phase disagrees. Run after scripts/kind-up.sh.
set -euo pipefail

CTX="${KUBE_CONTEXT:-kind-openvoid-local}"
NS="netpol-check"
IMAGE="busybox:1.36"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi
step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
fail() { printf "  ${RED}✗${RESET} %s\n" "$1"; }
note() { printf "  ${YELLOW}…${RESET} %s\n" "$1"; }

k() { kubectl --context "$CTX" -n "$NS" "$@"; }

cleanup() { kubectl --context "$CTX" delete namespace "$NS" --wait=false >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Returns 0 if the client reached the server, 1 otherwise.
probe() {
  k exec netpol-client -- wget -T 4 -q -O- "http://netpol-server:8080" 2>/dev/null | grep -q REACHED
}

step "Setup (namespace ${NS})"
kubectl --context "$CTX" delete namespace "$NS" --ignore-not-found --wait=true >/dev/null 2>&1 || true
kubectl --context "$CTX" create namespace "$NS" >/dev/null

cat <<EOF | k apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: netpol-server
  labels: { app: netpol-server }
spec:
  containers:
    - name: server
      image: ${IMAGE}
      command: ["sh","-c","mkdir -p /www && echo REACHED > /www/index.html && httpd -f -p 8080 -h /www"]
      ports: [{ containerPort: 8080 }]
---
apiVersion: v1
kind: Service
metadata:
  name: netpol-server
spec:
  selector: { app: netpol-server }
  ports: [{ port: 8080, targetPort: 8080 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: netpol-client
  labels: { app: netpol-client }
spec:
  containers:
    - name: client
      image: ${IMAGE}
      command: ["sh","-c","sleep 3600"]
EOF

k wait --for=condition=Ready pod/netpol-server pod/netpol-client --timeout=120s >/dev/null
ok "server and client pods Ready"

step "Phase 1 — baseline, no policy"
reached=0
for _ in $(seq 1 10); do probe && { reached=1; break; }; sleep 2; done
if [ "$reached" = 1 ]; then
  ok "client reached server (the test itself works)"
else
  fail "client could NOT reach server with no policy — the probe is broken, not the CNI"
  exit 1
fi

step "Phase 2 — deny policy applied"
cat <<EOF | k apply -f - >/dev/null
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: server-ingress
spec:
  podSelector:
    matchLabels: { app: netpol-server }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { netpol-allowed: "yes" }
EOF

blocked=0
for _ in $(seq 1 10); do probe || { blocked=1; break; }; sleep 2; done
if [ "$blocked" = 1 ]; then
  ok "client blocked — NetworkPolicy is enforced"
else
  fail "client STILL reached server with a deny policy in place."
  fail "The CNI is ignoring NetworkPolicy (kindnet does this)."
  fail "Recreate the cluster: bash scripts/kind-down.sh && bash scripts/kind-up.sh"
  exit 1
fi

step "Phase 3 — client relabelled to match the policy"
k label pod netpol-client netpol-allowed=yes --overwrite >/dev/null
reached=0
for _ in $(seq 1 10); do probe && { reached=1; break; }; sleep 2; done
if [ "$reached" = 1 ]; then
  ok "client reached server again — policy selects, it does not just block"
else
  fail "client still blocked after matching the policy's selector."
  fail "Traffic is being dropped for some other reason; the deny in phase 2 proves nothing."
  exit 1
fi

echo
printf "${GREEN}${BOLD}NetworkPolicy is enforced by this cluster's CNI.${RESET}\n"
