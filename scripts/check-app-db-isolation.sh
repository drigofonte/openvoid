#!/usr/bin/env bash
# Prove that two app databases cannot reach each other's data.
#
# This is U4's verification, and it is the spike's failing test inverted: in
# docs/spikes/2026-08-29-documentdb-multitenancy.md, one app's credentials read
# another app's private document and dropped its collection. Here they must not.
#
# Isolation rests on three independent layers. Two are testable here, each at
# the level it actually operates:
#
#   PostgreSQL layer — app A's credentials rejected by app B's database. Tested
#     through a port-forward, which deliberately bypasses the NetworkPolicy so
#     the auth boundary is measured on its own.
#   Network layer   — a session pod labelled for app A reaches app A's Service
#     and is refused by app B's. Tested pod-to-pod inside the cluster, the only
#     path where NetworkPolicy applies.
#
# The third layer is the separate instance itself, which needs no test: app B's
# data is in a different PostgreSQL process on a different volume.
#
# Requires: a cluster with a policy-enforcing CNI (scripts/check-netpol.sh),
# and both images pushed to the local registry.
set -euo pipefail

CTX="${KUBE_CONTEXT:-kind-openvoid-local}"
NS="openvoid-app-data"
SESSION_NS="openvoid-sessions"
APP_A="01JQISOLATIONAAAAAAAAAAAAA"
APP_B="01JQISOLATIONBBBBBBBBBBBBB"
PW_A="AppAPassword123"
PW_B="AppBPassword123"
KEEP="${KEEP:-0}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi
step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
fail() { printf "  ${RED}✗${RESET} %s\n" "$1"; }
note() { printf "  ${YELLOW}…${RESET} %s\n" "$1"; }

k() { kubectl --context "$CTX" "$@"; }

PF_PIDS=()
cleanup() {
  for pid in "${PF_PIDS[@]:-}"; do kill "$pid" >/dev/null 2>&1 || true; done
  if [ "$KEEP" = "1" ]; then
    note "KEEP=1 — leaving ${NS} in place"
    return
  fi
  # PVCs are retained by policy when a StatefulSet goes, so a stale volume
  # would make the next run skip initialisation and reuse the old database.
  k delete namespace "$NS" --wait=true --timeout=180s >/dev/null 2>&1 || true
  k delete pod -n "$SESSION_NS" -l openvoid.io/isolation-probe=true --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

lower() { echo "$1" | tr '[:upper:]' '[:lower:]'; }
svc_of() { echo "app-$(lower "$1")-mongo"; }
sts_of() { echo "app-$(lower "$1")-db"; }

uri_for() { # host port user password
  echo "mongodb://$3:$4@$1:$2/?tls=true&tlsAllowInvalidCertificates=true&directConnection=true"
}

step "Preflight"
k get nodes >/dev/null || { echo "cluster unreachable"; exit 1; }
ok "cluster ${CTX} reachable"

step "Namespace and shared config"
# A namespace still terminating from a previous run silently rejects every
# create that follows.
for _ in $(seq 1 60); do k get namespace "$NS" >/dev/null 2>&1 || break; sleep 3; done
k create namespace "$NS" --dry-run=client -o yaml | k apply -f - >/dev/null
k create namespace "$SESSION_NS" --dry-run=client -o yaml | k apply -f - >/dev/null
k create configmap app-db-config -n "$NS" \
  --from-file="${REPO_ROOT}/infra/app-db/postgresql.conf" \
  --from-file="${REPO_ROOT}/infra/app-db/pg_hba.conf" \
  --from-file="${REPO_ROOT}/infra/app-db/pg_ident.conf" \
  --from-file="${REPO_ROOT}/infra/app-db/bootstrap.sh" \
  --from-file="${REPO_ROOT}/infra/app-db/pg_url" \
  --dry-run=client -o yaml | k apply -f - >/dev/null
ok "namespace ${NS} and app-db-config in place"

step "Provisioning two apps"
for pair in "${APP_A}:${PW_A}" "${APP_B}:${PW_B}"; do
  app="${pair%%:*}"; pw="${pair##*:}"
  (cd "${REPO_ROOT}/services/session-api" && \
    pnpm --silent exec tsx scripts/emit-app-db-manifests.ts "$app" "$pw") | k apply -f - >/dev/null
done
ok "manifests applied (both start hibernated at replicas=0)"

step "Waking both"
for app in "$APP_A" "$APP_B"; do
  k scale statefulset "$(sts_of "$app")" -n "$NS" --replicas=1 >/dev/null
done
for app in "$APP_A" "$APP_B"; do
  if ! k rollout status statefulset "$(sts_of "$app")" -n "$NS" --timeout=420s >/dev/null 2>&1; then
    fail "$(sts_of "$app") did not become ready"
    k get pods -n "$NS" -o wide
    k describe pod -n "$NS" -l "openvoid.io/app-id=${app}" | sed -n '/Events:/,$p' | tail -20
    exit 1
  fi
done
ok "both app databases Ready"

step "Port-forwards (these bypass NetworkPolicy by design)"
PF_LOG_DIR="$(mktemp -d)"
start_pf() { # service local-port
  local log="${PF_LOG_DIR}/$2.log"
  k port-forward -n "$NS" "svc/$1" "$2:27017" >"$log" 2>&1 &
  PF_PIDS+=($!)
  # Wait for kubectl's own "Forwarding from" line. A /dev/tcp probe is not
  # enough — the socket can accept before the tunnel is usable, and a
  # port-forward that dies immediately leaves nothing to probe at all.
  for _ in $(seq 1 30); do
    grep -q "Forwarding from" "$log" 2>/dev/null && return 0
    sleep 1
  done
  fail "port-forward to $1 never started"
  cat "$log"
  return 1
}
start_pf "$(svc_of "$APP_A")" 27101 || exit 1
start_pf "$(svc_of "$APP_B")" 27102 || exit 1
ok "forwarding A→27101, B→27102"

step "Phase 1 — each app works with its own credentials"
for pair in "27101:${PW_A}:alpha" "27102:${PW_B}:beta"; do
  port="${pair%%:*}"; rest="${pair#*:}"; pw="${rest%%:*}"; tag="${rest##*:}"
  out=$(npx --yes mongosh@latest "$(uri_for 127.0.0.1 "$port" appuser "$pw")" --quiet --eval "
    const d = db.getSiblingDB('private');
    d.secrets.insertOne({_id:'s1', owner:'${tag}', value:'${tag}-PRIVATE-DATA'});
    print(JSON.stringify(d.secrets.find({}).toArray()));
  " 2>&1 | tail -2) || true
  case "$out" in
    *"${tag}-PRIVATE-DATA"*) ok "${tag}: wrote and read its own private document" ;;
    *) fail "${tag}: could not use its own database"; echo "$out"; exit 1 ;;
  esac
done

step "Phase 2 — PostgreSQL layer: app A's credentials against app B"
out=$(npx --yes mongosh@latest "$(uri_for 127.0.0.1 27102 appuser "$PW_A")" --quiet --eval "
  print(JSON.stringify(db.getSiblingDB('private').secrets.find({}).toArray()));
" 2>&1 | tail -3) || true
case "$out" in
  *beta-PRIVATE-DATA*)
    fail "app A's credentials READ app B's private data — isolation is broken"
    echo "$out"; exit 1 ;;
  *)
    ok "app A's credentials rejected by app B's database"
    note "$(echo "$out" | head -1 | cut -c1-100)" ;;
esac

step "Phase 3 — network layer: a session pod labelled for app A"
k run isolation-probe -n "$SESSION_NS" --image=busybox:1.36 --restart=Never \
  --labels="openvoid.io/app-id=${APP_A},openvoid.io/isolation-probe=true" \
  --command -- sh -c 'sleep 600' >/dev/null
k wait -n "$SESSION_NS" --for=condition=Ready pod/isolation-probe --timeout=120s >/dev/null
ok "probe pod running in ${SESSION_NS}, labelled as app A's session"

probe() { # service-name -> 0 if reachable
  k exec -n "$SESSION_NS" isolation-probe -- \
    nc -z -w 4 "$1.${NS}.svc.cluster.local" 27017 >/dev/null 2>&1
}

reached=0
for _ in $(seq 1 8); do probe "$(svc_of "$APP_A")" && { reached=1; break; }; sleep 2; done
if [ "$reached" = 1 ]; then
  ok "reaches app A's database — the policy admits its own session pod"
else
  fail "cannot reach app A's own database; the policy is too strict to be meaningful"
  exit 1
fi

blocked=0
for _ in $(seq 1 8); do probe "$(svc_of "$APP_B")" || { blocked=1; break; }; sleep 2; done
if [ "$blocked" = 1 ]; then
  ok "blocked from app B's database — NetworkPolicy holds"
else
  fail "app A's session pod REACHED app B's database over the network"
  fail "Check the CNI enforces policy: bash scripts/check-netpol.sh"
  exit 1
fi

echo
printf "${GREEN}${BOLD}Isolation holds at both the PostgreSQL and network layers.${RESET}\n"
printf "  The spike's failing test now passes.\n"
