// U4 — per-app database topology builders.
//
// These pin the contract that U1/U2 established the hard way, where the failure
// modes are silent rather than loud:
//   - both containers on the same UID (peer auth resolves it server-side)
//   - both mounting the shared socket volume (the only path to PostgreSQL)
//   - PVC retained on scale-down (the alternative deletes user data)
//   - the NetworkPolicy carries `_from`, which the client maps to `from`;
//     a raw `from` would be dropped, leaving a rule that denies everything

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  APP_DB_CONFIG_MAP_NAME,
  APP_DB_GATEWAY_PORT,
  APP_DB_MONGO_PORT,
  APP_DB_NAMESPACE,
  APP_DB_RUN_AS_USER,
  APP_DB_SOCKET_MOUNT_PATH,
  APP_LABEL,
  appDbConnectionUri,
  appDbName,
  appDbServiceName,
  buildAppDbNetworkPolicy,
  buildAppDbResources,
  buildAppDbService,
  buildAppDbStatefulSet,
  getAppDbStorageClass,
} from "../../src/k8s/app-db.js";

const APP_ID = "01JQTESTAPP0000000000000A";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("naming", () => {
  it("lowercases app IDs so names are valid DNS labels", () => {
    expect(appDbName(APP_ID)).toBe(`app-${APP_ID.toLowerCase()}-db`);
    expect(appDbServiceName(APP_ID)).toBe(`app-${APP_ID.toLowerCase()}-mongo`);
    expect(appDbName(APP_ID)).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
  });
});

describe("StatefulSet", () => {
  it("runs both containers as the PostgreSQL UID", () => {
    // A mismatch fails every gateway connection with "provided user name ...
    // and authenticated user name ... do not match".
    const sts = buildAppDbStatefulSet(APP_ID);
    expect(sts.spec?.template.spec?.securityContext?.runAsUser).toBe(APP_DB_RUN_AS_USER);
  });

  it("mounts the shared socket volume into both containers", () => {
    const containers = buildAppDbStatefulSet(APP_ID).spec?.template.spec?.containers ?? [];
    expect(containers.map((c) => c.name).sort()).toEqual(["gateway", "postgres"]);
    for (const c of containers) {
      const paths = (c.volumeMounts ?? []).map((m) => m.mountPath);
      expect(paths).toContain(APP_DB_SOCKET_MOUNT_PATH);
    }
  });

  it("starts hibernated", () => {
    expect(buildAppDbStatefulSet(APP_ID).spec?.replicas).toBe(0);
  });

  it("retains the volume when scaled to zero and when deleted", () => {
    const policy = buildAppDbStatefulSet(APP_ID).spec?.persistentVolumeClaimRetentionPolicy;
    expect(policy?.whenScaled).toBe("Retain");
    expect(policy?.whenDeleted).toBe("Retain");
  });

  it("gates readiness on the gateway proving the backend works", () => {
    const gw = buildAppDbStatefulSet(APP_ID).spec?.template.spec?.containers?.find(
      (c) => c.name === "gateway",
    );
    expect(gw?.readinessProbe?.exec?.command).toEqual([
      "/usr/bin/documentdb-gateway",
      "check",
    ]);
  });

  it("takes the app password from the per-app Secret, never inline", () => {
    const pg = buildAppDbStatefulSet(APP_ID).spec?.template.spec?.containers?.find(
      (c) => c.name === "postgres",
    );
    const pw = pg?.env?.find((e) => e.name === "APP_DB_PASSWORD");
    expect(pw?.value).toBeUndefined();
    expect(pw?.valueFrom?.secretKeyRef?.name).toBe(`app-${APP_ID.toLowerCase()}-db-credentials`);
  });

  it("mounts the shared config ConfigMap read-only in both containers", () => {
    const sts = buildAppDbStatefulSet(APP_ID);
    const volume = sts.spec?.template.spec?.volumes?.find((v) => v.name === "config");
    expect(volume?.configMap?.name).toBe(APP_DB_CONFIG_MAP_NAME);
    for (const c of sts.spec?.template.spec?.containers ?? []) {
      const mount = (c.volumeMounts ?? []).find((m) => m.name === "config");
      expect(mount?.readOnly).toBe(true);
    }
  });

  it("gives the gateway a writable TLS state directory", () => {
    // The image's own directory is owned by its packaged user; the pod's
    // runAsGroup is not that group, so the gateway panics at startup with
    // "Cannot create TLS state directory ... Permission denied".
    const sts = buildAppDbStatefulSet(APP_ID);
    const gw = sts.spec?.template.spec?.containers?.find((c) => c.name === "gateway");
    const dir = gw?.env?.find((e) => e.name === "DOCUMENTDB_TLS_STATE_DIR")?.value;
    expect(dir).toBe("/var/lib/documentdb-gateway/tls");
    // Mounted over the PARENT, not the tls directory itself: the image ships
    // the parent as drwxrwx--- owned by its packaged user, so the pod's UID
    // cannot traverse into a volume mounted beneath it.
    const mount = (gw?.volumeMounts ?? []).find((m) => m.name === "gateway-state");
    expect(mount?.mountPath).toBe("/var/lib/documentdb-gateway");
    const vol = sts.spec?.template.spec?.volumes?.find((v) => v.name === "gateway-state");
    expect(vol?.emptyDir).toBeDefined();
  });

  it("does not give the pod an API token", () => {
    expect(buildAppDbStatefulSet(APP_ID).spec?.template.spec?.automountServiceAccountToken).toBe(
      false,
    );
  });

  it("honours the storage class override", () => {
    vi.stubEnv("OPENVOID_APP_DB_STORAGE_CLASS", "do-block-storage");
    expect(getAppDbStorageClass()).toBe("do-block-storage");
    const claim = buildAppDbStatefulSet(APP_ID).spec?.volumeClaimTemplates?.[0];
    expect(claim?.spec?.storageClassName).toBe("do-block-storage");
  });
});

describe("Service", () => {
  it("exposes the Mongo port and targets the gateway", () => {
    const port = buildAppDbService(APP_ID).spec?.ports?.[0];
    expect(port?.port).toBe(APP_DB_MONGO_PORT);
    expect(port?.targetPort).toBe("mongo");
  });

  it("selects only this app's pod", () => {
    expect(buildAppDbService(APP_ID).spec?.selector).toEqual({ [APP_LABEL]: APP_ID });
  });
});

describe("NetworkPolicy", () => {
  it("uses `_from`, which serializes to `from`", () => {
    // A plain `from` key is dropped by the client, leaving an empty rule that
    // denies all traffic — a silent failure this test exists to prevent.
    const np = buildAppDbNetworkPolicy(APP_ID);
    const rule = np.spec?.ingress?.[0] as Record<string, unknown> | undefined;
    expect(rule).toBeDefined();
    expect(rule).toHaveProperty("_from");
    expect(Array.isArray(rule?._from)).toBe(true);
  });

  it("admits only this app's session pod, on the gateway port", () => {
    const np = buildAppDbNetworkPolicy(APP_ID);
    const rule = np.spec?.ingress?.[0];
    const peer = rule?._from?.[0];
    expect(peer?.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"]).toBe(
      "openvoid-sessions",
    );
    expect(peer?.podSelector?.matchLabels?.[APP_LABEL]).toBe(APP_ID);
    expect(rule?.ports?.[0]?.port).toBe(APP_DB_GATEWAY_PORT);
  });

  it("scopes to this app's database pod", () => {
    expect(buildAppDbNetworkPolicy(APP_ID).spec?.podSelector.matchLabels).toEqual({
      [APP_LABEL]: APP_ID,
    });
  });
});

describe("connection URI", () => {
  it("addresses the app's own Service", () => {
    const uri = appDbConnectionUri(APP_ID, "pw");
    expect(uri).toContain(`${appDbServiceName(APP_ID)}.${APP_DB_NAMESPACE}.svc.cluster.local`);
    expect(uri).toContain(`:${APP_DB_MONGO_PORT}/`);
  });

  it("percent-encodes passwords so URI parsing cannot break", () => {
    expect(appDbConnectionUri(APP_ID, "p@ss:w/rd")).toContain("p%40ss%3Aw%2Frd");
  });
});

describe("resource set", () => {
  it("builds every object in the same namespace with the app label", () => {
    const r = buildAppDbResources(APP_ID, "pw");
    for (const obj of [r.secret, r.statefulSet, r.service, r.networkPolicy]) {
      expect(obj.metadata?.namespace).toBe(APP_DB_NAMESPACE);
      expect(obj.metadata?.labels?.[APP_LABEL]).toBe(APP_ID);
    }
  });
});
