#!/usr/bin/env bash
# Run one app database locally, in Docker, and leave it running.
#
# Stands up the same pair a per-app pod will hold — PostgreSQL+DocumentDB and
# the wire-protocol gateway sharing a Unix socket — and prints a mongodb:// URI
# you can point MongoDB Compass, mongosh, or any driver at.
#
# This is NOT the Kubernetes data plane. There is no StatefulSet, no per-app
# provisioning, no hibernation and no NetworkPolicy here; those arrive with U4
# and U10. It is the engine, reachable, so you can see what an app will see.
#
#   scripts/app-db-dev.sh up     [name]   # default name: dev
#   scripts/app-db-dev.sh down   [name]
#   scripts/app-db-dev.sh status [name]
#
# Requires the two images built: see infra/images/*/README.md.
set -euo pipefail

CMD="${1:-up}"
NAME="${2:-dev}"
PG_IMAGE="${APP_DB_PG_IMAGE:-openvoid/postgres-documentdb:18-0.116-0}"
GW_IMAGE="${APP_DB_GW_IMAGE:-openvoid/documentdb-gateway:0.116-0}"
PORT="${APP_DB_PORT:-27017}"
APP_DB="app"
APP_USER="appuser"
APP_PW="${APP_DB_PASSWORD:-AppUser123}"
PG_UID=26

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NET="appdb-${NAME}"; PG_C="appdb-${NAME}-pg"; GW_C="appdb-${NAME}-gw"; VOL="appdb-${NAME}-sock"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi
step() { printf "${BOLD}${BLUE}▸${RESET} ${BOLD}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
note() { printf "  ${YELLOW}…${RESET} %s\n" "$1"; }

down() {
  step "Tearing down ${NAME}"
  docker rm -f "$GW_C" "$PG_C" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  ok "removed containers, network and socket volume"
  note "the database itself lived in the container; nothing persists"
}

case "$CMD" in
  down) down; exit 0 ;;
  status)
    docker ps --filter "name=appdb-${NAME}-" --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
    exit 0 ;;
  up) ;;
  *) echo "usage: $0 {up|down|status} [name]"; exit 1 ;;
esac

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
for img in "$PG_IMAGE" "$GW_IMAGE"; do
  docker image inspect "$img" >/dev/null 2>&1 || {
    echo "missing image: ${img}"
    echo "build it first — see infra/images/*/README.md"
    exit 1
  }
done

down >/dev/null 2>&1 || true

step "Network and shared socket volume"
docker network create "$NET" >/dev/null
docker volume create "$VOL" >/dev/null
# The socket directory must be writable by the UID both containers run as.
docker run --rm -v "${VOL}:/sockets" --user 0 "$PG_IMAGE" chown "${PG_UID}:${PG_UID}" /sockets >/dev/null
ok "created"

step "PostgreSQL + DocumentDB"
docker run -d --name "$PG_C" --network "$NET" -v "${VOL}:/sockets" \
  -v "${REPO_ROOT}/infra/app-db:/app-db:ro" --user "$PG_UID" "$PG_IMAGE" \
  bash -euo pipefail -c "
    export PGDATA=/var/lib/postgresql/data/pgdata
    initdb -D \"\$PGDATA\" -U postgres --auth-local=peer --auth-host=scram-sha-256 >/dev/null
    cat /app-db/postgresql.conf >> \"\$PGDATA/postgresql.conf\"
    cp /app-db/pg_hba.conf /app-db/pg_ident.conf \"\$PGDATA/\"
    pg_ctl -D \"\$PGDATA\" -l /tmp/pg.log -w start >/dev/null
    createdb -U postgres ${APP_DB}
    psql -U postgres -d ${APP_DB} -v ON_ERROR_STOP=1 -q \
      -c 'CREATE EXTENSION IF NOT EXISTS documentdb CASCADE;' \
      -c \"CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PW}';\" \
      -c 'GRANT documentdb_admin_role TO ${APP_USER};'
    echo BACKEND_READY
    sleep infinity
  " >/dev/null

for i in $(seq 1 60); do
  docker logs "$PG_C" 2>&1 | grep -q BACKEND_READY && break
  docker ps -q --filter "name=$PG_C" | grep -q . || { echo "backend died:"; docker logs "$PG_C" 2>&1 | tail -20; exit 1; }
  sleep 2
done
ok "extension installed, ${APP_USER} role created"

step "Gateway"
# Same UID as PostgreSQL (peer auth resolves the UID server-side), URL points at
# the shared socket, and port 5432 is explicit because the gateway defaults to 9712.
docker run -d --name "$GW_C" --network "$NET" -v "${VOL}:/sockets" -p "${PORT}:10260" \
  --user "$PG_UID" -e DOCUMENTDB_PG_URL_FILE=/tmp/pg_url \
  --entrypoint bash "$GW_IMAGE" -c "
    umask 077
    printf 'postgresql://postgres@%%2Fsockets:5432/${APP_DB}' > /tmp/pg_url
    exec /usr/bin/documentdb-gateway run
  " >/dev/null

for i in $(seq 1 40); do
  docker logs "$GW_C" 2>&1 | grep -q "ready to accept connections" && break
  [ "$i" = 40 ] && { echo "gateway did not start:"; docker logs "$GW_C" 2>&1 | tail -15; exit 1; }
  sleep 2
done
ok "listening on localhost:${PORT}"

URI="mongodb://${APP_USER}:${APP_PW}@localhost:${PORT}/?tls=true&tlsAllowInvalidCertificates=true&directConnection=true"
echo
printf "${GREEN}${BOLD}app database '${NAME}' is up.${RESET}\n\n"
printf "  ${BOLD}Connection URI${RESET} (Compass, mongosh, any driver):\n\n    %s\n\n" "$URI"
printf "  TLS is a self-signed cert, hence tlsAllowInvalidCertificates.\n"
printf "  Compass will connect and browse; its ${BOLD}Performance tab will not work${RESET} —\n"
printf "  the gateway does not implement serverStatus or top.\n\n"
printf "  ${BOLD}SQL side${RESET} (DBeaver, psql) — the same data as BSON rows:\n\n"
printf "    docker exec -it %s psql -U postgres -d %s\n\n" "$PG_C" "$APP_DB"
printf "  ${BOLD}Tear down${RESET}: scripts/app-db-dev.sh down %s\n" "$NAME"
