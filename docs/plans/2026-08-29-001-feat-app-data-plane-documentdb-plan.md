---
title: App Data Plane — Per-App DocumentDB
type: feat
status: active
date: 2026-08-29
origin:
  - docs/spikes/2026-08-29-documentdb-multitenancy.md
  - docs/ideation/2026-05-23-roadmap-to-public-do-release-ideation.md
---

# App Data Plane — Per-App DocumentDB

## Summary

Gives every openvoid app a MongoDB-compatible database that no other app can read or destroy, so
agent-generated code can persist data with a standard MongoDB driver and no openvoid-specific client.
The engine is DocumentDB (PostgreSQL extension + its own wire-protocol gateway); FerretDB is dropped.
Isolation is enforced by giving each app its own PostgreSQL instance, because the spike
established that no weaker boundary exists in DocumentDB 0.116-0. Idle apps hibernate to zero compute
while retaining their volume. Because cluster-per-app converts an isolation problem into an operations
problem, the observability and diagnostic surface is a gating deliverable: **no app receives a database
until Phase C is complete.**

This is the app **data plane**. It is distinct from, and independent of, the control-plane Postgres in
`docs/plans/2026-05-27-001` U1, which holds openvoid's own users, credentials, and audit log.

---

## Problem Frame

openvoid generates apps that need to persist data. Today they have nowhere to put it. The obvious
answer — one shared MongoDB-compatible service with a database per app — was tested in
`docs/spikes/2026-08-29-documentdb-multitenancy.md` and does not hold:

- A MongoDB database is not a PostgreSQL schema. Every collection in every app lands in one flat
  cluster-wide `documentdb_data` schema; the database name is a column value, not a namespace.
- The only functional DocumentDB role (`documentdb_admin_role`) owns every collection table. Under it,
  one app's credential read another app's private document and dropped its collection. The
  lesser role (`documentdb_readwrite_role`) cannot create or read a collection at all — there is no
  middle setting.
- A PostgreSQL database per app inside one cluster is foreclosed: `pg_cron` is a hard dependency of the
  extension and binds to a single `cron.database_name` per cluster.

openvoid apps run agent-generated code on behalf of arbitrary users, so co-tenants are untrusted by
definition. An isolation boundary that depends on apps behaving is not a boundary.

---

## Requirements

- R1. Every app receives a MongoDB-compatible database, provisioned at app creation (user decision,
  2026-08-29: no opt-in, no provision-on-first-use — agent-generated code may always assume a database
  exists, which removes a conditional from the scaffold and the agent's instructions)
- R2. No app can read, write, or destroy another app's data. Enforced by infrastructure, not convention
- R3. Apps connect using standard MongoDB drivers against a normal connection string
- R4. An idle app consumes no compute; its data survives untouched
- R5. Waking is transparent — a session reaching Ready implies its database is reachable
- R6. The operator can answer "why is app X's database misbehaving" from a central surface, without
  per-app `kubectl` archaeology, and can inspect an app's actual data with a normal GUI client
- R7. Credentials are per-app, rotatable, and never shared between apps
- R8. Metrics, health view, diagnostics, and the hibernation controller exist **before** any app is
  given a database (user decision, 2026-08-29: ops tooling gates rollout)
- R9. The DocumentDB engine stays current and is upgradable across N clusters as one operation

---

## Scope Boundaries

- Control-plane Postgres (users, credentials, audit) — `2026-05-27-001` U1, unrelated cluster
- BYOK user secrets and the OpenBao key model — `2026-05-27-001`, different class of secret
- DOKS cluster provisioning, Terraform, CI/CD — platform-cicd ideation (Item 2)
- Relational (SQL) access for generated apps — apps get the document API only at v1
- Cross-app or shared datasets between apps — no mechanism, deliberately
- Vector search, geospatial, full-text — available in the engine, unwired and untested here
- Multi-instance HA per app cluster — single instance per app at v1; HA is a per-app tier decision later
- End-user-facing database UI (browsing collections in the openvoid app) — separate surface

### Deferred to Follow-Up Work

- Per-app resource tiers (an app that outgrows the default footprint)
- Read replicas and connection pooling per app
- Point-in-time recovery beyond the daily backup baseline in U9
- Migration path if DocumentDB RFC-006 lands per-database RBAC and consolidation becomes attractive

---

## Context & Research

### Spike findings that constrain this design

All from `docs/spikes/2026-08-29-documentdb-multitenancy.md`, tested against DocumentDB 0.116-0 /
PostgreSQL 17:

| Finding | Consequence for this plan |
|---|---|
| F1 — FerretDB dormant (last commit 2026-02-07), DocumentDB ships `pg_documentdb_gw` | Gateway comes from DocumentDB; FerretDB is not a dependency |
| F2 — Mongo database is a catalog column, not a PG schema | No schema-level grant strategy is possible |
| F3 — only `documentdb_admin_role` functions, and it is cross-tenant | Isolation must come from separate clusters |
| F4 — `pg_cron` binds the extension to one database per cluster | A cheap per-app database is not available |

### Image availability (researched 2026-08-29)

DocumentDB publishes **no** CNPG-compatible PostgreSQL image. It ships `documentdb-local` (an
all-in-one emulator container bundling Postgres + gateway, unsuitable for CNPG) and DEB/RPM packages.
The only existing CNPG-usable image, `ghcr.io/ferretdb/postgres-documentdb`, is built by the dormant
FerretDB project and tops out at DocumentDB `0.105.0` — eleven releases behind `0.116-0`.

openvoid must therefore build and maintain its own images (U1, U2) from DocumentDB's packages.
**Ubuntu 24.04 + PostgreSQL 17/18 is upstream's Tier 1**: first-party CI builds, tests, and runs an
install→setup→wire-protocol E2E on every cell of that matrix, so it is the paved road for a derived
image. This is real ongoing maintenance against a monthly-releasing upstream and is called out as a
risk rather than buried.

### Relevant code and patterns

- Session lifecycle and K8s object creation: `services/session-api/src/k8s/client.ts` — already the
  component that builds and applies per-session manifests; per-app database objects belong here
- Pod phase observation: `services/session-api/src/k8s/pod-status.ts` — the pattern the wake gate reuses
- Reaper-controller precedent: `2026-05-27-001` U13 (two-phase staging reaper) — same shape of
  cluster-side controller watching phase transitions
- Helm values abstraction: `docs/solutions/best-practices/helm-routing-abstraction-2026-05-03.md` —
  kind vs DOKS differences live in values, not caller code
- Readiness gating precedent: roadmap survivor 8a, server-side ingress-readiness gate

---

## Key Technical Decisions

- **KD1. DocumentDB's own gateway, not FerretDB.** FerretDB duplicates `pg_documentdb_gw` and is
  effectively unmaintained. Confirmed by spike F1 and by its stale image tags.
- **KD2. One PostgreSQL cluster per app.** Not a preference — spike F3/F4 leave no enforced alternative
  at 0.116-0. Revisit if RFC-006 ships per-database RBAC.
- **KD3. A plain StatefulSet per app, no operator.** Decided 2026-08-30, after U2 established that the
  gateway must share PostgreSQL's pod (KD5) and CNPG will not admit a second container without a
  CNPG-I plugin. The deciding factor is that this is the same shape of work session-api already does
  in `services/session-api/src/k8s/client.ts` — pods, volumes, containers — so no new competency
  enters the codebase, and an incident is debugged by reading a pod and two container logs rather than
  an operator's reconciliation loop. Hibernation survives (scale to zero retains PVCs), and failover
  was never used since v1 is single-instance. **What openvoid takes on instead:** backups, a metrics
  exporter, and image-tag upgrades. Rewritten as U3, U9 and U10 below.
- **KD4. Build our own Postgres+DocumentDB image.** No suitable upstream image exists; the only
  candidate is stale and comes from the project we just dropped.
- **KD5. ~~Gateway as a separate per-app Deployment.~~ INVALIDATED 2026-08-30 by building it (U2).**
  The OSS gateway reaches PostgreSQL *only* over a local Unix socket with peer auth — it rejects
  password-bearing URLs outright and the source states it "only supports passwordless local peer auth".
  It cannot address a remote database, so it cannot be its own Deployment pointing at the CNPG `-rw`
  Service. Gateway and PostgreSQL must share a filesystem, which in Kubernetes means **one pod**. CNPG
  injects sidecars only through CNPG-I plugins; there is no generic sidecar field on the Cluster spec.
  The replacement decision is an open question below and is **not** settled by this plan.
- **KD6. Lifecycle driven from session-api, with a reconciler for drift.** session-api already creates
  K8s objects and owns the session lifecycle that hibernation keys off.
- **KD7. Hibernate aggressively, wake on session start.** With every app holding a cluster (R1), most
  clusters are idle most of the time. The live support surface is then bounded by concurrent sessions,
  not by total apps — this is the mitigation that makes R1 affordable, and it is load-bearing.
- **KD8. App database credentials are platform-managed, not BYOK.** They are generated by openvoid, not
  supplied by the user, so they do not enter the OpenBao user-KEK model in `2026-05-27-001`. How they
  reach the pod is an open question below.
- **KD9. No single isolation layer is trusted.** Separate clusters, NetworkPolicy, and per-app
  credentials are independent, and the design assumes any one of them may be misconfigured. This is not
  theoretical: the NetworkPolicy is a verified no-op under kind's default CNI and is bypassed by
  `kubectl port-forward`, which is the operator access path in U13. Follows the precedent already set
  at `services/session-api/src/k8s/client.ts:360`, where the agent pod's ServiceAccount token is
  disabled as defence in depth rather than relying on NetworkPolicy alone.

---

## Open Questions

### Resolved during planning

- *FerretDB or the DocumentDB gateway?* — DocumentDB gateway (KD1)
- *Shared instance or cluster per app?* — cluster per app; nothing weaker is enforceable (KD2)
- *Which apps get a database?* — all of them, at app creation (R1)
- *How much ops investment before rollout?* — ops gates rollout (R8)
- *PostgreSQL 17 or 18?* — **18**, resolved in U1 by building it. Upstream's paved-road default, CNPG
  supports it, and the image runs PostgreSQL 18.6 with DocumentDB 0.116-0 verified end to end. The
  Dockerfile is parameterised by `PG_MAJOR`, so 17 remains a one-argument fallback
- *Which base image?* — **Ubuntu 24.04**, resolved in U1 the hard way (see below)

### Deferred to implementation

- **Hibernation wake latency.** Undocumented upstream and unmeasured here. U6 measures it before the
  wake strategy is finalized. If wake is fast (order seconds), hibernate on session end. If slow, keep
  the cluster warm for the session's lifetime plus a grace window, and start the wake earlier in the
  provisioning sequence. This fork is why U6 precedes the lifecycle work.
- **Where the connection string lives.** The threat model forbids plaintext user secrets via the K8s
  Secret API, but these are platform-generated credentials to a per-app database, a lower class than
  BYOK. Options: reuse the CSI/tmpfs path from `2026-05-27-001` U12 for consistency, or a plain
  per-app K8s Secret. Decide in U7 against the threat model's actual wording, not by analogy.
- **Backup destination.** DO Spaces is the obvious target for the `pg_dump` CronJob in U9, but the
  bucket, credentials and retention interact with Item 2's infra decisions.
- ~~How the gateway gets into the same pod as PostgreSQL~~ — **resolved 2026-08-30: plain StatefulSet.**
  See KD3 for the reasoning and what it costs.

---

## High-Level Technical Design

Per app, one workload and one boundary. The two containers share a pod because the gateway reaches
PostgreSQL only over a Unix socket (KD5) — that constraint, not preference, sets this shape:

```
app-<appId>
  ├── StatefulSet   app-<appId>-db         replicas 0|1 — scaling to 0 IS hibernation
  │     ├── container  postgres            openvoid/postgres-documentdb, runs as uid 26
  │     ├── container  gateway             openvoid/documentdb-gateway, same uid 26
  │     ├── volume     socket (emptyDir)   shared; carries the PostgreSQL socket for peer auth
  │     └── volumeClaimTemplate  data      PVC retained on scale-down (the default), so data
  │                                        survives hibernation — the durable artifact
  ├── ConfigMap     app-<appId>-pgconf     postgresql.conf, pg_hba.conf, pg_ident.conf
  ├── Service       app-<appId>-mongo      :27017 → gateway :10260
  └── NetworkPolicy                        ingress to the gateway only from that app's session pod
```

The session pod receives `OPENVOID_DATABASE_URL` (a `mongodb://` string pointing at the app's Service)
and connects with an ordinary driver. It never learns PostgreSQL credentials and never reaches another
app's Service — denied both by NetworkPolicy and by the per-app PostgreSQL role.

Lifecycle:

```
app created      → provision StatefulSet (replicas 0) + ConfigMap + Service + NetworkPolicy
session starts   → scale to 1, gate session Ready on the database accepting connections
session ends     → scale to 0 after a grace window; the PVC stays
app deleted      → delete all objects; PVC deletion is explicit and audited
```

Isolation rests on three independent layers, so no single failure exposes another app's data: separate
PostgreSQL clusters (separate processes, separate volumes, separate credentials), NetworkPolicy, and
per-app PostgreSQL roles.

---

## Implementation Units

### U1. `openvoid/postgres-documentdb` image

**Goal:** A CNPG-compatible PostgreSQL image carrying the DocumentDB extension at a pinned version.

**Requirements:** R9 · **Dependencies:** none

- Base on CNPG's PostgreSQL image for the chosen major; install `postgresql-N-documentdb` plus the
  `pg_cron`, `vector`, `postgis`, `tsm_system_rows` dependencies the extension declares
- Set `shared_preload_libraries = pg_cron, pg_documentdb_core, pg_documentdb` and
  `cron.database_name` to the app database, via the ConfigMap in U3 rather than baked into the image
- Reconcile UID/GID: CNPG runs PostgreSQL as UID 26; DocumentDB's own packaging expects 999. The
  FerretDB CNPG write-up hit exactly this and it is the most likely first failure
- Pin the DocumentDB version explicitly; the tag encodes PG major + extension version
- CI builds on a schedule so a stale base is visible rather than silent

**Verification:** the container starts and `CREATE EXTENSION documentdb CASCADE` succeeds with
`SELECT extversion` matching the pinned version. The image stays CNPG-compatible (uid 26, PGDG layout,
required binaries on PATH) even though KD3 no longer runs CNPG — it costs nothing and keeps that door
open.

**Status: built and verified 2026-08-29** — `infra/images/postgres-documentdb/`. PostgreSQL 18.6 with
DocumentDB 0.116-0, `documentdb_core` and `pg_cron` 1.6 loading under the preload set, and a document
round-tripping through `documentdb_api`. Verified on **both arm64 and amd64** (the latter cross-built
and smoke-tested under emulation, since DOKS is amd64); ~220MB, 3 layers, on each.
`smoke-test.sh` is the reusable proof; run it after any base-image, PostgreSQL-major, or DocumentDB
bump.

What the build settled, none of which was predictable from the documentation:

- **The base image cannot be CNPG's own.** Building `FROM ghcr.io/cloudnative-pg/postgresql`
  (Debian trixie) to inherit CNPG's weekly security rebuilds installs cleanly and then fails at
  startup: `undefined symbol: ucol_getSortKey_74`. ICU exports version-suffixed symbols; upstream links
  against Ubuntu 24.04's libicu74 and trixie ships libicu76. The image is therefore Ubuntu 24.04 —
  upstream's Tier 1 target — mirroring CNPG's Dockerfile structure rather than extending its image.
  **The cost lands on us:** openvoid owns base-image patching, so the scheduled CI rebuild below is
  required rather than tidy
- **Extensions are ordinary apt packages** in CNPG's model, so the PGDG dependencies
  (`-cron`, `-pgvector`, `-postgis-3`) install normally, and the extension package is checksum-verified
  against upstream's `SHA256SUMS`
- **The UID 26 reconciliation was a non-issue** — `usermod -u 26 postgres` on the Ubuntu base, exactly
  as CNPG does on Debian
- **Cluster config the image deliberately does not bake in** (U4 must set it): the preload libraries,
  `cron.database_name`, `listen_addresses` including localhost — DocumentDB opens internal libpq
  connections over TCP and a socket-only server fails at the first API call — and
  `documentdb_core.bsonUseEJson = on`, which is off by default and is the difference between readable
  extended JSON and a `BSONHEX...` dump when inspecting data over SQL (U13)

**Remaining:** multi-arch publish and the scheduled rebuild, both of which need the registry and CI that
Item 2 owns.

---

### U2. `openvoid/documentdb-gateway` image

**Goal:** Standalone gateway image speaking the MongoDB wire protocol to a remote PostgreSQL.

**Requirements:** R3 · **Dependencies:** none (parallel with U1)

- Build from the `documentdb-gateway` package; the systemd unit it ships is irrelevant in a container
- Configure via the `DOCUMENTDB_*` environment variables added upstream in v0.114 rather than by
  templating `SetupConfiguration.json`
- Point at the CNPG `-rw` Service; TLS on, certificate from the cluster issuer
- Verify `documentdb-gateway check`, the connectivity probe subcommand, works as a container healthcheck

**Verification:** a MongoDB driver completes insert/find against a CNPG cluster through the image.

**Status: built and verified 2026-08-30** — `infra/images/documentdb-gateway/`. A real MongoDB client
inserts and finds a document over TLS through the gateway into DocumentDB.
`integration-test.sh` is the reusable proof and encodes the whole deployment contract.

The build disproved KD5 and surfaced a configuration contract that is invisible from the documentation:

- **Peer auth over a local Unix socket is the only supported path** (see KD5). The gateway must run as
  PostgreSQL's UID, because PostgreSQL resolves the peer UID against its own passwd database
- **A `pg_ident` map is mandatory**, not hardening. The gateway's system pool connects as its own role,
  but each client's data pool connects *as that client's role with an empty password*, which peer auth
  permits only via `+group` ident entries — a **PostgreSQL 16+** feature, which retroactively justifies
  choosing 18
- **`pg_hba` ordering matters**: the scoped rule must come first, since a catch-all peer rule locks out
  every other local user
- **The gateway defaults to PostgreSQL port 9712**, not 5432. Against CNPG the port must be explicit or
  it fails with a bare `error connecting to server`
- **The extension's own internal libpq connections default to `host=localhost` over TCP**, where they
  have no password. Without `documentdb.localhost_connection_string` and `cron.host` pointed at the
  socket, client auth succeeds and then every write fails with `fe_sendauth: no password supplied` from
  inside `create_collection`

**Remaining:** multi-arch publish, and U4 cannot proceed until the pod-topology question above is
resolved.

---

### U3. Cluster foundations and PostgreSQL configuration templates

**Goal:** The shared pieces every app database needs, and the config that makes the two containers
work together.

**Requirements:** R2, R9 · **Dependencies:** none

Replaces the CloudNativePG operator install, which KD3 removed.

- StorageClass selection and defaults, split kind vs DOKS per the helm-routing-abstraction pattern
- The `postgresql.conf`, `pg_hba.conf` and `pg_ident.conf` templates, whose exact contents are
  recorded in `infra/images/documentdb-gateway/README.md` and enforced by its integration test. These
  are not boilerplate: without the `pg_ident` `+group` map the gateway cannot authenticate clients at
  all, and without `documentdb.localhost_connection_string` and `cron.host` pointed at the socket every
  write fails from inside the extension
- **A policy-enforcing CNI for kind** (Calico or Cilium), replacing kindnet. Without it the
  NetworkPolicy in U4 is a silent no-op and R2 cannot be tested locally at all
- Tilt wiring so a local cluster comes up with all of the above

**Status: built and verified 2026-08-30.**

- `infra/app-db/{postgresql.conf,pg_hba.conf,pg_ident.conf}` + README. These are not a copy of the
  settings U2 discovered — `infra/images/documentdb-gateway/integration-test.sh` now mounts and uses
  these exact files, so the shipped config is the tested config and the two cannot drift
- Calico v3.32.1 replaces kindnet: `disableDefaultCNI` in `infra/local/kind-cluster.yaml`,
  `infra/local/calico-installation.yaml` pinning the pod CIDR to kind's `10.244.0.0/16` (deliberately
  not Calico's own 192.168.0.0/16 default, which collides with most home networks), and a pinned
  install step in `scripts/kind-up.sh`
- `scripts/check-netpol.sh` proves enforcement in three phases — baseline reaches, deny blocks, and a
  relabelled client reaches again. The third phase matters: "nothing can reach anything" is not
  enforcement, and without it a broken pod network would look like a working policy. **Verified passing
  on the rebuilt cluster**
- StorageClass split documented (kind `standard`, DOKS `do-block-storage`), read by U4 from
  `OPENVOID_APP_DB_STORAGE_CLASS`
- No Tilt changes were needed: the CNI must exist before Tilt runs, so it belongs in `kind-up.sh`, and
  the app-db ConfigMap has no consumer until U4

Two ordering bugs surfaced while bringing the cluster up, both now fixed in `kind-up.sh`: the Installation
CR must wait for its CRD to be Established (the operator Deployment going Available does not imply it),
and the readiness wait must follow the DaemonSet rollout rather than `kubectl wait` on a pod, because the
operator replaces that pod mid-reconcile and the wait then fails on a name that no longer exists.

**Note for the next local rebuild:** `kind-down.sh` recreates the registry empty, so `tilt up` rebuilds
the session-api and landing images on first run after a teardown. Expect ImagePullBackOff until it does.

---

### U4. Per-app topology templates

**Goal:** The four objects above, generated from an app ID.

**Requirements:** R1, R2, R3 · **Dependencies:** U1, U2, U3

- `StatefulSet` (two containers, shared `emptyDir` for the socket, `volumeClaimTemplate` for data),
  `ConfigMap`, `Service`, `NetworkPolicy` — generated from an app ID, following the manifest-building
  patterns already in `services/session-api/src/k8s/client.ts`
- Both containers run as uid 26 and share the socket volume; the gateway's readiness probe is
  `documentdb-gateway check`
- NetworkPolicy restricting gateway ingress to the pod labelled with that app ID — but treat it as the
  **weakest** of the three isolation layers, for three verified reasons: kind's default CNI (kindnet)
  does not implement NetworkPolicy at all, so the policy is a silent no-op in local development; a
  policy whose `podSelector` fails to match its target leaves the pod with no policy and therefore
  allow-all ingress, so it fails **open**; and `kubectl port-forward` bypasses it entirely, since that
  traffic originates from the kubelet rather than pod-to-pod. Local verification of R2 therefore
  requires swapping kindnet for Calico or Cilium — otherwise the isolation test in this unit passes
  regardless of whether the policy is correct
- Per-app PostgreSQL role created at first start by an init step; the app's role is admin **within its
  own database only**, which is safe precisely because nothing is shared with another app
- Resource requests sized from U6's measurements, not guessed

**Verification:** two apps provisioned side by side; app A's credentials fail against app B's Service
at both the network layer and the PostgreSQL layer. This is the spike's failing test, now passing.

**Status: built and verified 2026-08-30** — `services/session-api/src/k8s/app-db.ts` (19 unit tests) and
`scripts/check-app-db-isolation.sh`, which provisions two apps and passes all three phases:

```
✓ alpha / beta: each wrote and read its own private document
✓ app A's credentials rejected by app B's database      (PostgreSQL layer)
✓ app A's session pod reaches A, blocked from B         (network layer)
```

The two layers are tested where each actually operates: the auth boundary through a port-forward, which
deliberately bypasses NetworkPolicy so it is measured alone, and the network boundary pod-to-pod, the
only path where NetworkPolicy applies. The third layer — a separate PostgreSQL process on a separate
volume — needs no test.

Four failures during bring-up, each silent rather than loud, and each now pinned by a test:

- **`_from` vs `from`.** The generated client renames NetworkPolicy's `from` field and maps it back on
  serialization. Dumping the object with `JSON.stringify` emits `_from`, which the API server ignores —
  leaving an ingress rule that matches no sources and denies everything. It would have looked like
  working isolation
- **The gateway's TLS state directory.** The image ships `/var/lib/documentdb-gateway` as
  `drwxrwx---` owned by its packaged user, so the pod's UID cannot even traverse it, and `fsGroup` fixes
  a mounted volume's ownership rather than the image directory above it. The volume is mounted over the
  parent, not the `tls` subdirectory. This did not appear in Docker, where `--user 26` yields GID 0
- **`psql -c` does not interpolate psql variables.** `CREATE ROLE :"role"` reached the server verbatim.
  The role was never created and the failure surfaced much later as the gateway's
  `Invalid account: User details not found in the database`. Bootstrap now feeds SQL on stdin, which
  interpolates — and keeps the password off the command line
- **A stale PVC** from an earlier run made `bootstrap.sh` skip initialisation and silently reuse the
  previous database. The check script now waits for full namespace deletion

`infra/app-db/bootstrap.sh` is the pod's entrypoint and is also what `scripts/app-db-dev.sh` runs, so
the local Docker path and the Kubernetes path cannot drift.

**Provisional:** container resource requests are guesses until U6 measures a real cluster — the unit
that exists precisely to stop this being sized by guesswork.

---

### U5. Provisioning lifecycle in session-api

**Goal:** Create on app creation, delete on app deletion, idempotently.

**Requirements:** R1, R7 · **Dependencies:** U4

- Extend `services/session-api/src/k8s/client.ts` with app-database create/delete
- Idempotent: re-running against an existing app is a no-op, not an error or a second cluster
- Deletion is explicit about the PVC and emits an audit event — this is the destructive path
- Provisioning failure must not block app creation; the app surfaces a degraded database state rather
  than failing outright

**Verification:** unit tests over manifest generation; integration test creating and deleting an app.

---

### U6. Footprint and wake-latency measurement

**Goal:** Replace estimates with numbers, and settle the KD7 fork.

**Requirements:** R4, R5, R8 · **Dependencies:** U4

**This unit gates the lifecycle design.** Measure, on both kind and DOKS:

- Idle (hibernated) cost: PVC only — confirm zero pods and zero CPU
- Active footprint: memory and CPU of one cluster plus gateway under a trivial workload
- **Hibernation wake latency**: annotation flip → accepting MongoDB connections, measured repeatedly,
  cold and warm image cache
- Time to provision a brand-new app database from nothing
- Extrapolated cost for 10, 50, 200 apps, separating storage from compute

Write the numbers into the plan and into the runbook. If wake latency is incompatible with a
transparent session start, adopt the warm-for-session-duration strategy from Open Questions.

**Status: measured 2026-08-30** — `scripts/measure-app-db.sh`, kind, warm image cache:

| | |
|---|---|
| Provision from nothing → Ready | **12s** (includes `initdb` and `CREATE EXTENSION documentdb CASCADE`) |
| Wake from hibernation (avg of 3) | **8.1s** — min 7.5s, max 8.7s |
| Active memory | **114 MiB** — PostgreSQL 110, gateway 4 |
| Hibernated | 0 pods, PVC retained, 73 MiB used by a fresh database |

**KD7 is confirmed: hibernate aggressively.** An ~8s wake is well inside a session start, which already
pays pod scheduling, image pull, repo clone and `pnpm install`. The database wakes in parallel and is
not the critical path, so the warm-for-session-duration fallback in Open Questions is not needed.

**The cost model, corrected.** The two terms scale on different axes, and only one tracks signups:

| Apps | Storage provisioned (2Gi each) | Compute if *all* active | Compute at 10 concurrent |
|---|---|---|---|
| 10 | 20 GiB | 1.1 GiB | 1.1 GiB |
| 50 | 100 GiB | 5.6 GiB | 1.1 GiB |
| 200 | 400 GiB | 22 GiB | 1.1 GiB |

Compute tracks **concurrent sessions**, not total apps — which is exactly what KD7 was relying on, now
with numbers behind it. Storage tracks total apps and is the term that grows with signups, so the 2Gi
default per app is the lever worth revisiting before the fleet is large. Apply DigitalOcean's current
block-storage rate to the middle column for a monthly figure; the arithmetic here is deliberately in
GiB rather than currency.

**Fed back into the code:** the gateway's memory request drops from 64Mi to 32Mi — it was a 16x
over-provision against 4 MiB measured, and requests are what constrain how many apps fit on a node.
PostgreSQL's 256Mi request stands, now with a basis rather than a guess.

**Not measured, and stated rather than glossed:** DOKS, since there is no remote cluster yet; and cold
image pull, since these images are already on the node — a first-ever wake on a fresh node adds the
pull. Both are Item 2 territory.

---

### U7. Credentials

**Goal:** Per-app credentials, generated, injected, rotatable.

**Requirements:** R7 · **Dependencies:** U4, U5

- Generate a strong per-app password at provisioning; never reuse across apps. Credentials are not
  made redundant by the NetworkPolicy: the policy separates app A from app B but explicitly permits
  app A's own pod — which runs agent-generated, prompt-injectable code — to reach the database. They
  are also the only revocation primitive (rotate and the connection dies) and the only thing that turns
  an operator fat-finger into a clean auth error rather than a silent write into the wrong app's data.
  There is no anonymous mode to fall back on regardless: the gateway authenticates against PostgreSQL
  roles, and CNPG generates a password whether or not it is managed
- Resolve the open question on delivery mechanism against the threat model's wording (KD8)
- Inject `OPENVOID_DATABASE_URL` into the session pod
- Rotation procedure: change the PostgreSQL role password, restart the gateway, no data movement
- Credentials never appear in logs, in the agent's context, or in the app's git repository — the
  no-inline-secrets guardrail from roadmap survivor 7a applies here

---

### U8. Observability — **gates rollout**

**Goal:** One place that answers "how is every app's database doing".

**Requirements:** R6, R8 · **Dependencies:** U3, U4

- CNPG's Prometheus metrics plus the gateway's OTLP metrics into the central stack
- A Grafana dashboard keyed by app ID: up/hibernated, connections, storage used vs. requested, slow
  queries, gateway error rate and latency
- Alerts for the failure modes that actually generate support load: volume near full, wake failure,
  cluster not reaching Ready, gateway crash-looping, backup failure
- Fleet view: all app databases in one table, sortable by health — the answer to "is anything broken
  right now" without knowing which app to look at

---

### U9. Diagnostics, backups, and restore — **gates rollout**

**Goal:** A first response that does not start with improvising `kubectl`.

**Requirements:** R6, R8 · **Dependencies:** U4, U8

- `scripts/db-diagnose.sh <app-id>`: cluster phase, hibernation state, PVC usage, recent errors,
  gateway health, last backup, top slow queries — one command, one screen
- Scheduled backups to object storage — a per-app CronJob running `pg_dump`, with a retention policy.
  This is work KD3 moved onto openvoid; it is small but it is load-bearing, and it is the main thing
  given up by not running an operator
- A restore drill executed at least once and written down, because an untested restore is not a backup
- Follows the existing `diagnose.sh` convention at repo root

---

### U10. Hibernation controller

**Goal:** Idle apps cost nothing; a starting session finds its database ready.

**Requirements:** R4, R5 · **Dependencies:** U6 (strategy), U5, U8

- Wake on session creation by scaling the StatefulSet to 1; hibernate by scaling to 0 after the
  session ends plus a grace window. The PVC is retained on scale-down by default
  (`persistentVolumeClaimRetentionPolicy.whenScaled: Retain`) — set it explicitly rather than relying
  on the default, since the alternative silently deletes app data
- Wake is part of the session readiness gate — a session must not reach Ready with an unreachable
  database, which would surface as "my app is broken" and generate exactly the support load R6 targets
- Reconciler corrects drift: a woken cluster with no live session, a hibernated cluster with one
- Wake failure is a first-class, alerting, retried state — not a silent hang

---

### U11. Scaffold and agent integration

**Goal:** Generated code actually uses the database.

**Requirements:** R1, R3 · **Dependencies:** U7

- `OPENVOID_DATABASE_URL` in the session pod environment
- Scaffold template ships a MongoDB driver dependency and a connection helper
- Agent instructions under `infra/images/opencode/instructions/` tell the agent the database exists,
  how to reach it, and never to hardcode the connection string
- Because every app has a database (R1), the agent needs no conditional — the simplification that
  motivated the R1 decision

---

### U13. Operator client access — **gates rollout**

**Goal:** Inspect an app's real data with a normal GUI client, at both layers.

**Requirements:** R6, R8 · **Dependencies:** U4, U7

Verified against DocumentDB 0.116-0 on 2026-08-29 by exercising the admin-command surface through
`mongosh` 2.10.0; 18 of 23 probes passed.

- **MongoDB Compass → the per-app gateway.** The app's-eye view. Everything Compass needs to connect and
  browse works: `hello`, `buildInfo`, `connectionStatus`, `listDatabases`, `listCollections`, `dbStats`,
  `collStats`, `$collStats`, `listIndexes`, `find`, `countDocuments`, `explain`, `aggregate`,
  `createIndex`. **Compass's Performance tab will not work** — `serverStatus` and `top` are both
  unsupported by the gateway, as are `getParameter`, `getFreeMonitoringStatus` and `atlasVersion` (the
  last two are Atlas-only and degrade harmlessly). Document the Performance tab as a known dead end so
  it is not rediscovered during an incident
- **DBeaver → the CNPG cluster.** The operator's-eye view, and the more useful one for a slow app:
  `pg_stat_activity`, locks, index usage, table bloat, and the BSON rows in
  `documentdb_data.documents_<collection_id>`. This is where performance diagnosis actually happens,
  which is convenient given the gateway cannot serve Compass's performance view anyway.
  **`documentdb_core.bsonUseEJson` must be on** or every document reads as a `BSONHEX...` dump; it is
  off by default, and U1 sets it in the cluster config for this reason
- Both services are cluster-internal by design, so access is via `kubectl port-forward`. Note that this
  bypasses the NetworkPolicy (U4) — the operator path is a deliberate hole in the network layer, which
  is precisely why the credential layer in U7 carries the weight
- TLS: the gateway presents an auto-generated certificate; both clients need the CA trusted or
  invalid-certificate acceptance enabled. Document the exact connection strings
- Operator access uses a distinct break-glass credential, never an app's own, and emits an audit event.
  Reading a user's application data is a privileged act and should leave a trace, consistent with the
  audit posture in `2026-05-27-001` R10

**Verification:** connect Compass to a provisioned app database and browse a collection; connect DBeaver
to the same app's cluster and read the same document as BSON.

---

### U12. Operator runbook

**Goal:** The on-call human — you — can act without re-deriving the architecture.

**Requirements:** R6, R8 · **Dependencies:** all prior units

- `docs/runbooks/app-data-plane.md`: provisioning, wake/hibernate, diagnosing a slow or stuck app,
  connecting Compass and DBeaver to a named app (U13), restoring from backup, rotating credentials,
  upgrading DocumentDB across N clusters, decommissioning
- The N-cluster upgrade procedure is the one most likely to be needed and least likely to be obvious:
  staged rollout, canary app, rollback

---

## System-Wide Impact

- `services/session-api` gains app-database lifecycle alongside session lifecycle
- `infra/` gains two images openvoid builds and maintains against a monthly upstream
- Session readiness gains a dependency: the database must be reachable before Ready
- App deletion becomes genuinely destructive — it removes the only copy of user data outside backups
- The observability stack becomes load-bearing rather than nice-to-have (R8)

---

## Risks & Dependencies

| Risk | Likelihood | Mitigation |
|---|---|---|
| Custom image maintenance burden against a monthly-releasing upstream | High | Pin versions; scheduled CI rebuilds; upgrade procedure in U12. Accepted cost of KD1+KD4 |
| U1 image does not work under CNPG (UID/GID, preload libraries) | Medium | Highest-uncertainty unit, scheduled first; FerretDB's Dockerfile is a reference even though stale |
| Wake latency too slow for transparent session start | Medium | U6 measures before the design commits; documented fallback strategy |
| Per-app cost grows faster than modelled once every app has a cluster | Medium | U6 produces the cost model; hibernation is the lever; tiers are deferred work |
| Operational load still exceeds a solo operator despite tooling | Medium | The explicit reason R8 gates rollout. If U6/U8 show it is untenable, revisit KD2 before shipping |
| Reimplementing operator concerns (backup, upgrade, reconciliation) worse than CNPG would | Medium | Accepted cost of KD3. Scope is deliberately small — backup CronJob, exporter sidecar, tag bump. If the fleet grows enough that this hurts, revisit CNPG via a plugin then, with the shape known |
| Gateway's peer-auth-only constraint forces either a CNPG-I plugin or abandoning CNPG | ~~High~~ Resolved | Open question above; U2 verified the constraint, so this is certain rather than speculative. Option 1 preserves hibernation, which KD7 depends on |
| DocumentDB RFC-006 lands and makes cluster-per-app look heavy | Low | Consolidation is deferred work, not a blocker; the per-app boundary stays valid regardless |
| PVC left behind on app deletion, leaking storage cost silently | Medium | Explicit PVC handling and audit event in U5; storage alert in U8 |
| NetworkPolicy silently unenforced — no-op under kindnet, fails open on selector mismatch, bypassed by port-forward | High | Never the sole isolation layer (KD9); per-app clusters and per-app credentials hold independently; local R2 testing requires a policy-enforcing CNI |

### Dependencies / Prerequisites

- CNPG operator (U3) before any per-app object
- A container registry and CI able to build and publish images (Item 2 overlaps; U1 may need an interim
  manual publish path)
- Central Prometheus/Grafana — if not yet standing, U8 includes standing it up

---

## Phased Delivery

### Phase A: Images and operator (U1, U2, U3)
The riskiest work first. U1 and U2 are parallel; U3 is independent. Nothing app-facing exists yet.

### Phase B: One app database, by hand (U4, U5, U6)
Provision a database for a test app and measure it. U6's numbers feed back into U4's resource requests
and settle the hibernation strategy before it is built.

### Phase C: Ops surface — **the rollout gate** (U7, U8, U9, U13)
Credentials, observability, diagnostics, backups, a rehearsed restore, and working Compass/DBeaver
access. **No real app receives a database until this phase completes** (R8).

### Phase D: Lifecycle (U10)
Hibernation controller and the wake-aware readiness gate, built against measured latency.

### Phase E: Apps actually use it (U11, U12)
Scaffold and agent integration, then the runbook, written against surfaces that exist.

---

## Documentation Plan

- New: `docs/runbooks/app-data-plane.md` (U12)
- New: `docs/solutions/` entries as `/ce-compound` captures land — the CNPG + DocumentDB image build is
  near-certain to produce at least one
- Amended: `AGENTS.md` — stack overview gains the app data plane and its distinction from the
  control-plane Postgres
- Amended: `docs/spikes/2026-08-29-documentdb-multitenancy.md` — link to this plan as the outcome

---

## Operational / Rollout Notes

- Single instance per app cluster at v1; per-app HA is a tier decision, not a default
- The rollout gate is R8, and it is a real gate: Phase C complete, restore drill executed, fleet view
  populated
- First real rollout should be a small number of apps with the fleet view watched, not all at once
- If U6's numbers or U8's early signal show the operational load is untenable for one person, the
  correct response is to revisit KD2 before apps depend on it — reversing this after apps hold real
  data is expensive

---

## Sources & References

- `docs/spikes/2026-08-29-documentdb-multitenancy.md` — the empirical basis for KD1, KD2, KD4
- DocumentDB repo: `rfcs/006-rbac-support.md` (Draft), `packaging/README.md` (Tier 1 matrix),
  CHANGELOG (v0.114 `DOCUMENTDB_*` env config, v0.116-0 release)
- CloudNativePG declarative hibernation — `cnpg.io/hibernation` annotation, pods removed, PVCs retained
- FerretDB CNPG deployment write-up — reference for the UID/GID and preload-library pitfalls, noting
  its DocumentDB version is stale
