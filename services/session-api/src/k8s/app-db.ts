// Per-app database topology (U4 of the app data plane plan).
//
// Every app gets its own PostgreSQL instance running the DocumentDB extension,
// because DocumentDB cannot enforce isolation between apps inside one instance:
// the only functional role can read and drop every other app's data, and
// pg_cron limits a cluster to a single DocumentDB database. See
// docs/spikes/2026-08-29-documentdb-multitenancy.md.
//
// The two containers share a pod out of necessity, not preference — the gateway
// reaches PostgreSQL only over a Unix socket with peer auth. That constraint
// drives the shared emptyDir, the matching runAsUser, and the pg_ident map in
// the mounted config. See infra/images/documentdb-gateway/README.md.

import type {
  V1ConfigMap,
  V1NetworkPolicy,
  V1Secret,
  V1Service,
  V1StatefulSet,
} from "@kubernetes/client-node";

import { MANAGED_BY_LABEL, MANAGED_BY_VALUE, SESSION_NAMESPACE } from "./client.js";

export const APP_DB_NAMESPACE = "openvoid-app-data";
export const APP_LABEL = "openvoid.io/app-id";

// The shared config: postgresql.conf, pg_hba.conf, pg_ident.conf, bootstrap.sh
// and pg_url, created from infra/app-db. Identical for every app — the database
// name is always `app` and the socket path is always the same — so it is one
// ConfigMap in the namespace rather than a copy per app.
export const APP_DB_CONFIG_MAP_NAME = "app-db-config";
export const APP_DB_CONFIG_MOUNT_PATH = "/app-db-config";

// PostgreSQL's UID in the postgres-documentdb image. The gateway must run as
// the same UID: PostgreSQL resolves the peer's UID against its own passwd
// database, and a mismatch fails every connection with "provided user name ...
// and authenticated user name ... do not match".
export const APP_DB_RUN_AS_USER = 26;

export const APP_DB_GATEWAY_STATE_VOLUME_NAME = "gateway-state";
// The volume is mounted over the gateway's whole state directory, not just the
// tls subdirectory beneath it. The image ships that directory as
// `drwxrwx--- documentdb-gateway:root`, which the pod's UID can neither write
// nor traverse — and fsGroup fixes ownership of a mounted volume, not of the
// image directory above it. Mounting the parent replaces it outright.
export const APP_DB_GATEWAY_STATE_DIR = "/var/lib/documentdb-gateway";
export const APP_DB_GATEWAY_TLS_DIR = `${APP_DB_GATEWAY_STATE_DIR}/tls`;
export const APP_DB_SOCKET_VOLUME_NAME = "socket";
export const APP_DB_SOCKET_MOUNT_PATH = "/sockets";
export const APP_DB_DATA_VOLUME_NAME = "data";
export const APP_DB_DATA_MOUNT_PATH = "/var/lib/postgresql/data";
export const APP_DB_PGDATA = `${APP_DB_DATA_MOUNT_PATH}/pgdata`;

export const APP_DB_MONGO_PORT = 27017;
export const APP_DB_GATEWAY_PORT = 10260;
export const APP_DB_GATEWAY_PORT_NAME = "mongo";

export const APP_DB_USER = "appuser";
export const APP_DB_NAME = "app";
export const APP_DB_PASSWORD_SECRET_KEY = "password";

export const DEFAULT_APP_DB_PG_IMAGE = "localhost:5001/openvoid/postgres-documentdb:18-0.116-0";
export const DEFAULT_APP_DB_GATEWAY_IMAGE = "localhost:5001/openvoid/documentdb-gateway:0.116-0";
export const DEFAULT_APP_DB_STORAGE_CLASS = "standard";
export const DEFAULT_APP_DB_STORAGE_SIZE = "2Gi";

// Sized from U6's measurements (scripts/measure-app-db.sh, kind, 2026-08-30):
// PostgreSQL settled at 110 MiB and the gateway at 4 MiB on a freshly
// initialised, idle database. Requests keep real headroom over that, because
// the measured workload was empty — PostgreSQL grows with data, connections and
// shared_buffers, and the gateway with concurrent clients.
//
// CPU is deliberately left at a modest request: U6 did not measure it under
// load, and an idle database tells you nothing useful about it.
export const APP_DB_PG_CPU_REQUEST = "100m";
export const APP_DB_PG_MEMORY_REQUEST = "256Mi";
export const APP_DB_PG_MEMORY_LIMIT = "1Gi";
export const APP_DB_GATEWAY_CPU_REQUEST = "50m";
// Was 64Mi, a 16x over-provision against the 4 MiB measured. 32Mi still leaves
// 8x headroom, and the request is what constrains how many apps fit on a node.
export const APP_DB_GATEWAY_MEMORY_REQUEST = "32Mi";
export const APP_DB_GATEWAY_MEMORY_LIMIT = "256Mi";

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export function getAppDbPgImage(): string {
  return envOr("OPENVOID_APP_DB_PG_IMAGE", DEFAULT_APP_DB_PG_IMAGE);
}

export function getAppDbGatewayImage(): string {
  return envOr("OPENVOID_APP_DB_GATEWAY_IMAGE", DEFAULT_APP_DB_GATEWAY_IMAGE);
}

export function getAppDbStorageClass(): string {
  return envOr("OPENVOID_APP_DB_STORAGE_CLASS", DEFAULT_APP_DB_STORAGE_CLASS);
}

export function getAppDbStorageSize(): string {
  return envOr("OPENVOID_APP_DB_STORAGE_SIZE", DEFAULT_APP_DB_STORAGE_SIZE);
}

// App IDs share the session-id convention: uppercase ULIDs in the domain,
// lowercase in resource names because K8s names must be DNS labels.
function appIdLower(appId: string): string {
  return appId.toLowerCase();
}

export function appDbName(appId: string): string {
  return `app-${appIdLower(appId)}-db`;
}

export function appDbServiceName(appId: string): string {
  return `app-${appIdLower(appId)}-mongo`;
}

export function appDbSecretName(appId: string): string {
  return `app-${appIdLower(appId)}-db-credentials`;
}

export function appDbLabels(appId: string): Record<string, string> {
  return {
    [APP_LABEL]: appId,
    [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  };
}

// The mongodb:// URI handed to the app's session pod. TLS is on with a
// self-signed certificate the gateway generates, hence the invalid-certificate
// allowance; U7 revisits once there is a cluster issuer.
export function appDbConnectionUri(appId: string, password: string): string {
  const host = `${appDbServiceName(appId)}.${APP_DB_NAMESPACE}.svc.cluster.local`;
  return (
    `mongodb://${APP_DB_USER}:${encodeURIComponent(password)}@${host}:${APP_DB_MONGO_PORT}/` +
    `?tls=true&tlsAllowInvalidCertificates=true&directConnection=true`
  );
}

export function buildAppDbSecret(appId: string, password: string): V1Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: appDbSecretName(appId),
      namespace: APP_DB_NAMESPACE,
      labels: appDbLabels(appId),
    },
    type: "Opaque",
    stringData: { [APP_DB_PASSWORD_SECRET_KEY]: password },
  };
}

export function buildAppDbStatefulSet(appId: string): V1StatefulSet {
  const name = appDbName(appId);
  const labels = appDbLabels(appId);

  return {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name, namespace: APP_DB_NAMESPACE, labels },
    spec: {
      serviceName: appDbServiceName(appId),
      // Zero is hibernation: the pods go, the PVC stays. U10 drives this.
      replicas: 0,
      selector: { matchLabels: { [APP_LABEL]: appId } },
      // Retain on scale-down is the Kubernetes default, but it is stated
      // explicitly because the alternative silently deletes the app's data.
      persistentVolumeClaimRetentionPolicy: { whenScaled: "Retain", whenDeleted: "Retain" },
      template: {
        metadata: { labels },
        spec: {
          securityContext: {
            runAsUser: APP_DB_RUN_AS_USER,
            runAsGroup: APP_DB_RUN_AS_USER,
            // Makes the mounted PVC writable by the PostgreSQL UID.
            fsGroup: APP_DB_RUN_AS_USER,
          },
          // The pod holds user data and has no business talking to the API.
          automountServiceAccountToken: false,
          containers: [
            {
              name: "postgres",
              image: getAppDbPgImage(),
              // The image is a bare operand with no initialising entrypoint.
              command: ["bash", `${APP_DB_CONFIG_MOUNT_PATH}/bootstrap.sh`],
              env: [
                { name: "PGDATA", value: APP_DB_PGDATA },
                { name: "APP_DB_NAME", value: APP_DB_NAME },
                { name: "APP_DB_USER", value: APP_DB_USER },
                {
                  name: "APP_DB_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: appDbSecretName(appId),
                      key: APP_DB_PASSWORD_SECRET_KEY,
                    },
                  },
                },
              ],
              volumeMounts: [
                { name: APP_DB_DATA_VOLUME_NAME, mountPath: APP_DB_DATA_MOUNT_PATH },
                { name: APP_DB_SOCKET_VOLUME_NAME, mountPath: APP_DB_SOCKET_MOUNT_PATH },
                { name: "config", mountPath: APP_DB_CONFIG_MOUNT_PATH, readOnly: true },
              ],
              readinessProbe: {
                exec: { command: ["pg_isready", "-U", "postgres", "-d", APP_DB_NAME] },
                initialDelaySeconds: 5,
                periodSeconds: 5,
                failureThreshold: 12,
              },
              resources: {
                requests: { cpu: APP_DB_PG_CPU_REQUEST, memory: APP_DB_PG_MEMORY_REQUEST },
                limits: { memory: APP_DB_PG_MEMORY_LIMIT },
              },
            },
            {
              name: "gateway",
              image: getAppDbGatewayImage(),
              // Same UID as PostgreSQL — peer auth resolves it server-side.
              env: [
                {
                  name: "DOCUMENTDB_PG_URL_FILE",
                  value: `${APP_DB_CONFIG_MOUNT_PATH}/pg_url`,
                },
                // Points at the writable volume below rather than the image's
                // own directory, which the pod's GID cannot write.
                { name: "DOCUMENTDB_TLS_STATE_DIR", value: APP_DB_GATEWAY_TLS_DIR },
              ],
              ports: [
                { name: APP_DB_GATEWAY_PORT_NAME, containerPort: APP_DB_GATEWAY_PORT },
              ],
              volumeMounts: [
                { name: APP_DB_SOCKET_VOLUME_NAME, mountPath: APP_DB_SOCKET_MOUNT_PATH },
                { name: "config", mountPath: APP_DB_CONFIG_MOUNT_PATH, readOnly: true },
                { name: APP_DB_GATEWAY_STATE_VOLUME_NAME, mountPath: APP_DB_GATEWAY_STATE_DIR },
              ],
              // `check` probes the backend and verifies the extension is
              // loaded, so readiness means "a driver would succeed", not
              // merely "the process is up".
              readinessProbe: {
                exec: { command: ["/usr/bin/documentdb-gateway", "check"] },
                initialDelaySeconds: 5,
                periodSeconds: 5,
                failureThreshold: 12,
              },
              resources: {
                requests: {
                  cpu: APP_DB_GATEWAY_CPU_REQUEST,
                  memory: APP_DB_GATEWAY_MEMORY_REQUEST,
                },
                limits: { memory: APP_DB_GATEWAY_MEMORY_LIMIT },
              },
            },
          ],
          volumes: [
            { name: APP_DB_SOCKET_VOLUME_NAME, emptyDir: {} },
            // The gateway generates a self-signed certificate at startup and
            // needs somewhere to put it. The certificate is regenerated on each
            // wake, which is harmless while clients accept self-signed certs;
            // U7 revisits with a real issuer.
            { name: APP_DB_GATEWAY_STATE_VOLUME_NAME, emptyDir: {} },
            {
              name: "config",
              configMap: {
                name: APP_DB_CONFIG_MAP_NAME,
                // 0640 rather than the 0644 default: the gateway warns when its
                // URL file is world-readable.
                defaultMode: 0o640,
              },
            },
          ],
        },
      },
      volumeClaimTemplates: [
        {
          metadata: { name: APP_DB_DATA_VOLUME_NAME, labels },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: getAppDbStorageClass(),
            resources: { requests: { storage: getAppDbStorageSize() } },
          },
        },
      ],
    },
  };
}

export function buildAppDbService(appId: string): V1Service {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: appDbServiceName(appId),
      namespace: APP_DB_NAMESPACE,
      labels: appDbLabels(appId),
    },
    spec: {
      type: "ClusterIP",
      selector: { [APP_LABEL]: appId },
      ports: [
        {
          name: APP_DB_GATEWAY_PORT_NAME,
          port: APP_DB_MONGO_PORT,
          targetPort: APP_DB_GATEWAY_PORT_NAME,
          protocol: "TCP",
        },
      ],
    },
  };
}

// One of three independent isolation layers, and deliberately the one trusted
// least: a policy whose selector fails to match leaves the pod with allow-all
// ingress, kubectl port-forward bypasses it entirely, and a CNI that ignores
// NetworkPolicy makes it a silent no-op (scripts/check-netpol.sh guards that
// last one). The per-app instance and the per-app PostgreSQL role hold
// independently of it.
export function buildAppDbNetworkPolicy(appId: string): V1NetworkPolicy {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: appDbName(appId),
      namespace: APP_DB_NAMESPACE,
      labels: appDbLabels(appId),
    },
    spec: {
      podSelector: { matchLabels: { [APP_LABEL]: appId } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          // `_from`, not `from`: the generated client renames the field and maps
          // it back via baseName on serialization. Correct through the typed
          // API, but a raw JSON.stringify of this object emits `_from`, which
          // the API server ignores — leaving an empty rule that denies
          // everything. Serialize with ObjectSerializer if dumping to YAML.
          _from: [
            {
              // Session pods live in their own namespace; `kubernetes.io/metadata.name`
              // is set automatically by Kubernetes, so no extra labelling is needed.
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": SESSION_NAMESPACE },
              },
              // Only this app's session pod. Session pods do not carry the
              // app-id label yet — U5 adds it — so until then this policy
              // denies everything, which is the correct direction to fail.
              podSelector: { matchLabels: { [APP_LABEL]: appId } },
            },
          ],
          ports: [{ protocol: "TCP", port: APP_DB_GATEWAY_PORT }],
        },
      ],
    },
  };
}

export type AppDbResources = {
  secret: V1Secret;
  statefulSet: V1StatefulSet;
  service: V1Service;
  networkPolicy: V1NetworkPolicy;
};

export function buildAppDbResources(appId: string, password: string): AppDbResources {
  return {
    secret: buildAppDbSecret(appId, password),
    statefulSet: buildAppDbStatefulSet(appId),
    service: buildAppDbService(appId),
    networkPolicy: buildAppDbNetworkPolicy(appId),
  };
}

// The shared ConfigMap, built from the files in infra/app-db. Applied once per
// namespace rather than per app; `data` is supplied by the caller that read the
// files so this module stays free of filesystem access.
export function buildAppDbConfigMap(data: Record<string, string>): V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: APP_DB_CONFIG_MAP_NAME,
      namespace: APP_DB_NAMESPACE,
      labels: { [MANAGED_BY_LABEL]: MANAGED_BY_VALUE },
    },
    data,
  };
}
