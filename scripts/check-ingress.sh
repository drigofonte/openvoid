#!/usr/bin/env bash
# Phase 7 smoke test: prove the local cluster's ingress chain works
# end-to-end by deploying a hello-world Pod + Service + Ingress and
# fetching it through the host port. Tears everything down on exit.
#
# Two checks run:
#   1. Happy path — `curl http://hello.<DOMAIN>/` returns 200 with the
#      expected body. Proves: extraPortMappings → ingress-nginx →
#      Service → Pod.
#   2. Snippet annotation — a second Ingress with
#      `nginx.ingress.kubernetes.io/configuration-snippet` adds a custom
#      response header. Proves the controller was installed with
#      `--allow-snippet-annotations=true` (Unit 7.2 depends on this).
#
# Phase 8 will reuse this script against DOKS once cloudflared is up;
# the only difference is the DOMAIN variable.

set -euo pipefail

CONTEXT="${CONTEXT:-kind-openvoid-local}"
DOMAIN="${DOMAIN:-127.0.0.1.nip.io}"
SCHEME="${SCHEME:-http}"
NAMESPACE="openvoid-ingress-check"
HOST_HAPPY="hello.${DOMAIN}"
HOST_SNIPPET="snippet.${DOMAIN}"

# ---- formatting ----
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
fail() { printf "  ${RED}✗${RESET} %s\n" "$1"; exit 1; }
note() { printf "  ${YELLOW}…${RESET} %s\n" "$1"; }

cleanup() {
  step "Cleanup"
  kubectl --context "${CONTEXT}" delete namespace "${NAMESPACE}" \
    --ignore-not-found --wait=false >/dev/null 2>&1 || true
  ok "deleted namespace ${NAMESPACE} (async)"
}
trap cleanup EXIT

# ---- preflight ----

step "Preflight"
command -v kubectl >/dev/null || fail "kubectl not found"
command -v curl >/dev/null    || fail "curl not found"
kubectl --context "${CONTEXT}" version --request-timeout=5s >/dev/null 2>&1 \
  || fail "context ${CONTEXT} not reachable"
ok "tooling present, ${CONTEXT} reachable"

# ---- apply manifests ----

step "Deploy hello-world + Ingress"
kubectl --context "${CONTEXT}" apply -f - <<EOF >/dev/null
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
---
apiVersion: v1
kind: Pod
metadata:
  name: hello
  namespace: ${NAMESPACE}
  labels:
    app: hello
spec:
  containers:
    - name: hello
      image: hashicorp/http-echo:1.0.0
      args: ["-text=openvoid-ingress-ok"]
      ports:
        - containerPort: 5678
---
apiVersion: v1
kind: Service
metadata:
  name: hello
  namespace: ${NAMESPACE}
spec:
  selector:
    app: hello
  ports:
    - name: http
      port: 80
      targetPort: 5678
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: hello-happy
  namespace: ${NAMESPACE}
spec:
  ingressClassName: nginx
  rules:
    - host: ${HOST_HAPPY}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: hello
                port:
                  name: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: hello-snippet
  namespace: ${NAMESPACE}
  annotations:
    nginx.ingress.kubernetes.io/configuration-snippet: |
      add_header X-OpenVoid-Test "ok" always;
spec:
  ingressClassName: nginx
  rules:
    - host: ${HOST_SNIPPET}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: hello
                port:
                  name: http
EOF
ok "applied namespace + Pod + Service + 2 Ingresses"

kubectl --context "${CONTEXT}" wait --namespace "${NAMESPACE}" \
  --for=condition=Ready pod/hello --timeout=60s >/dev/null
ok "hello pod Ready"

# ---- happy path ----
# Ingress propagation through nginx can take a couple of seconds after
# the resource is created. Poll for up to 30 s.

step "Happy path: curl http://${HOST_HAPPY}/"
RESP=""
for _ in $(seq 1 30); do
  if RESP=$(curl -fsS --max-time 2 "${SCHEME}://${HOST_HAPPY}/" 2>/dev/null); then
    break
  fi
  sleep 1
done
if [ "${RESP}" = "openvoid-ingress-ok" ]; then
  ok "got expected body \"${RESP}\""
else
  fail "expected body 'openvoid-ingress-ok', got: '${RESP:-<empty>}'"
fi

# ---- snippet annotation ----

step "Snippet annotation: X-OpenVoid-Test header"
HEADERS=""
for _ in $(seq 1 30); do
  if HEADERS=$(curl -fsS --max-time 2 -D - -o /dev/null "${SCHEME}://${HOST_SNIPPET}/" 2>/dev/null); then
    break
  fi
  sleep 1
done
if printf "%s" "${HEADERS}" | grep -qi "^X-OpenVoid-Test:[[:space:]]*ok"; then
  ok "X-OpenVoid-Test: ok present (snippet annotations honored)"
else
  fail "X-OpenVoid-Test header missing — controller likely lacks --allow-snippet-annotations=true"
fi

echo
printf "${GREEN}${BOLD}ingress check passed.${RESET}\n"
