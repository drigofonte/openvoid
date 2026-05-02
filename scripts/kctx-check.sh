#!/usr/bin/env bash
# Print the current kubectl context with bright color so it's hard to
# miss before running a destructive command. Returns 0 if a context is
# set, 1 if not.
#
# Usage:
#   bash scripts/kctx-check.sh
#   bash scripts/kctx-check.sh && kubectl delete codingsession my-session
#
# Color coding:
#   green  — kind context (local, safe to wreck)
#   yellow — DOKS context (real money, real cluster)
#   red    — anything else (probably a context you don't want to touch)

set -u

if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''
fi

CTX="$(kubectl config current-context 2>/dev/null || true)"
NS="$(kubectl config view --minify -o jsonpath='{..namespace}' 2>/dev/null || true)"
NS="${NS:-default}"

if [ -z "${CTX}" ]; then
  printf "${RED}${BOLD}no kubectl context set${RESET}\n" >&2
  printf "  Hint: ${BOLD}kubectl config get-contexts${RESET} to list, ${BOLD}kubectl config use-context <name>${RESET} to switch.\n" >&2
  exit 1
fi

case "${CTX}" in
  kind-*)
    printf "context: ${GREEN}${BOLD}%s${RESET}  ${BOLD}(LOCAL)${RESET}  namespace: ${BOLD}%s${RESET}\n" "${CTX}" "${NS}"
    ;;
  do-*)
    printf "context: ${YELLOW}${BOLD}%s${RESET}  ${BOLD}(REMOTE — billed)${RESET}  namespace: ${BOLD}%s${RESET}\n" "${CTX}" "${NS}"
    ;;
  *)
    printf "context: ${RED}${BOLD}%s${RESET}  ${BOLD}(UNKNOWN)${RESET}  namespace: ${BOLD}%s${RESET}\n" "${CTX}" "${NS}"
    ;;
esac
