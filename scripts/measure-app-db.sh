#!/usr/bin/env bash
# Measure one app database: provisioning time, wake latency, and footprint.
#
# U6 of docs/plans/2026-08-29-001. The plan's resource requests are guesses and
# its cost model rests on hibernation being cheap and waking fast; this replaces
# both with numbers.
#
# Uses its own app ID so it never disturbs anything already running.
#
#   scripts/measure-app-db.sh [wake-iterations]   # default 3
set -euo pipefail

CTX="${KUBE_CONTEXT:-kind-openvoid-local}"
NS="openvoid-app-data"
APP="01JQMEASUREMENT0000000000"
PW="MeasurePw123"
ITERATIONS="${1:-3}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STS="app-$(echo "$APP" | tr '[:upper:]' '[:lower:]')-db"
POD="${STS}-0"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; BLUE=''; YELLOW=''; BOLD=''; RESET=''
fi
step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
note() { printf "  ${YELLOW}…${RESET} %s\n" "$1"; }

k() { kubectl --context "$CTX" "$@"; }

cleanup() {
  k delete statefulset "$STS" -n "$NS" --wait=true >/dev/null 2>&1 || true
  k delete svc,networkpolicy,secret -n "$NS" -l "openvoid.io/app-id=${APP}" >/dev/null 2>&1 || true
  # The retention policy keeps the PVC when the StatefulSet goes, which is the
  # point in production and litter here.
  k delete pvc -n "$NS" -l "openvoid.io/app-id=${APP}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

wait_ready() { # seconds -> echoes elapsed ms, or FAIL
  local deadline=$(( $(date +%s) + ${1:-300} ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$(k get pod "$POD" -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

step "Provisioning from nothing"
k get namespace "$NS" >/dev/null 2>&1 || k create namespace "$NS" >/dev/null
t0=$(now_ms)
(cd "${REPO_ROOT}/services/session-api" && \
  pnpm --silent exec tsx scripts/emit-app-db-manifests.ts "$APP" "$PW") | k apply -f - >/dev/null
k scale statefulset "$STS" -n "$NS" --replicas=1 >/dev/null
wait_ready 600 || { echo "never became ready"; k describe pod "$POD" -n "$NS" | sed -n '/Events:/,$p' | tail -15; exit 1; }
PROVISION_MS=$(( $(now_ms) - t0 ))
ok "first provision to Ready: $(( PROVISION_MS / 1000 ))s  (includes initdb + CREATE EXTENSION)"

step "Active footprint"
mem_of() { # container -> MiB
  k exec -n "$NS" "$POD" -c "$1" -- sh -c 'cat /sys/fs/cgroup/memory.current 2>/dev/null || cat /sys/fs/cgroup/memory/memory.usage_in_bytes' 2>/dev/null \
    | awk '{printf "%.0f", $1/1048576}'
}
PG_MEM=$(mem_of postgres); GW_MEM=$(mem_of gateway)
ok "postgres ${PG_MEM} MiB, gateway ${GW_MEM} MiB, total $(( PG_MEM + GW_MEM )) MiB"

# du, not df: kind's local-path provisioner is a hostPath, so df reports the
# node's whole filesystem rather than this volume.
PVC_USED=$(k exec -n "$NS" "$POD" -c postgres -- du -sm /var/lib/postgresql/data 2>/dev/null | awk '{print $1}')
ok "data directory: ${PVC_USED} MiB (a freshly initialised app database)"

step "Wake latency — ${ITERATIONS} hibernate/wake cycles"
TOTAL=0; MIN=999999; MAX=0
for i in $(seq 1 "$ITERATIONS"); do
  k scale statefulset "$STS" -n "$NS" --replicas=0 >/dev/null
  while k get pod "$POD" -n "$NS" >/dev/null 2>&1; do sleep 0.5; done

  t=$(now_ms)
  k scale statefulset "$STS" -n "$NS" --replicas=1 >/dev/null
  wait_ready 300 || { echo "wake ${i} timed out"; exit 1; }
  ms=$(( $(now_ms) - t ))

  TOTAL=$(( TOTAL + ms )); [ "$ms" -lt "$MIN" ] && MIN=$ms; [ "$ms" -gt "$MAX" ] && MAX=$ms
  printf "  wake %d: %d.%03ds\n" "$i" $(( ms / 1000 )) $(( ms % 1000 ))
done
AVG=$(( TOTAL / ITERATIONS ))

step "Hibernated footprint"
k scale statefulset "$STS" -n "$NS" --replicas=0 >/dev/null
while k get pod "$POD" -n "$NS" >/dev/null 2>&1; do sleep 0.5; done
PODS=$(k get pods -n "$NS" -l "openvoid.io/app-id=${APP}" --no-headers 2>/dev/null | wc -l | tr -d ' ')
PVCS=$(k get pvc -n "$NS" -l "openvoid.io/app-id=${APP}" --no-headers 2>/dev/null | wc -l | tr -d ' ')
ok "pods: ${PODS} (no compute), PVCs retained: ${PVCS} (data survives)"

STORAGE_REQ=$(k get pvc -n "$NS" -l "openvoid.io/app-id=${APP}" -o jsonpath='{.items[0].spec.resources.requests.storage}' 2>/dev/null)

echo
printf "${BOLD}Measured on %s (kind, warm image cache)${RESET}\n\n" "$(date +%Y-%m-%d)"
printf "  provision from nothing   %ss\n" "$(( PROVISION_MS / 1000 ))"
printf "  wake (avg of %d)          %d.%03ds   [min %d.%03ds, max %d.%03ds]\n" \
  "$ITERATIONS" $(( AVG / 1000 )) $(( AVG % 1000 )) $(( MIN / 1000 )) $(( MIN % 1000 )) $(( MAX / 1000 )) $(( MAX % 1000 ))
printf "  active memory            %s MiB  (postgres %s + gateway %s)\n" "$(( PG_MEM + GW_MEM ))" "$PG_MEM" "$GW_MEM"
printf "  hibernated               0 pods, %s PVC at %s requested, %s MiB used\n" "$PVCS" "${STORAGE_REQ:-?}" "${PVC_USED:-?}"
echo
printf "  ${YELLOW}Not measured:${RESET} DOKS (no remote cluster yet), and cold image pull —\n"
printf "  the images are already on the node here, so a first-ever wake on a\n"
printf "  fresh node will be slower by the pull time.\n"
