import { describe, it, expect, vi, beforeEach } from "vitest";
import type { V1Pod } from "@kubernetes/client-node";
import { sessionsRouter } from "../src/routes/sessions.js";
import {
  type PodOps,
  type SessionPodSpec,
  buildSessionPodManifest,
  SESSION_LABEL,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  WORKSPACE_VOLUME_NAME,
  WORKSPACE_MOUNT_PATH,
  WORKSPACE_FS_GROUP,
  GIT_CLONE_CONTAINER_NAME,
  GIT_CLONE_IMAGE,
  GIT_CREDS_SECRET_NAME,
  GIT_CREDS_SECRET_KEY,
  GIT_CREDS_VOLUME_NAME,
  GIT_CREDS_MOUNT_PATH,
  GIT_FINALIZER_CONTAINER_NAME,
  GIT_FINALIZER_IMAGE,
  TERMINATION_GRACE_PERIOD_SECONDS,
  DEFAULT_BRANCH,
  REPO_ANNOTATION,
  BRANCH_ANNOTATION,
  CREATED_AT_ANNOTATION,
  ACTIVE_DEADLINE_SECONDS,
} from "../src/k8s/client.js";

function makeMockOps(): PodOps & {
  createSessionPod: ReturnType<typeof vi.fn>;
  getSessionPod: ReturnType<typeof vi.fn>;
  deleteSessionPod: ReturnType<typeof vi.fn>;
} {
  return {
    createSessionPod: vi.fn(async (spec: SessionPodSpec) => buildSessionPodManifest(spec)),
    getSessionPod: vi.fn(async () => null),
    deleteSessionPod: vi.fn(async () => false),
  };
}

function podWith(
  phase: string,
  podIP?: string,
  annotations?: Record<string, string>,
): V1Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "session-x", namespace: "openvoid-sessions", annotations },
    status: { phase, podIP },
  };
}

describe("buildSessionPodManifest (Phase 4.1: workspace volume + fsGroup)", () => {
  const spec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: "nginx:alpine",
    repo: "https://github.com/example/x",
  };

  it("declares an emptyDir `workspace` volume on the Pod", () => {
    const manifest = buildSessionPodManifest(spec);
    const volumes = manifest.spec?.volumes ?? [];
    const workspace = volumes.find((v) => v.name === WORKSPACE_VOLUME_NAME);
    expect(workspace, "workspace volume should be declared").toBeDefined();
    expect(workspace?.emptyDir).toEqual({});
  });

  it("mounts the workspace volume on the main container", () => {
    const manifest = buildSessionPodManifest(spec);
    const mounts = manifest.spec?.containers?.[0]?.volumeMounts ?? [];
    expect(mounts).toContainEqual({
      name: WORKSPACE_VOLUME_NAME,
      mountPath: WORKSPACE_MOUNT_PATH,
    });
  });

  it("sets fsGroup so all containers can read/write the volume regardless of UID", () => {
    const manifest = buildSessionPodManifest(spec);
    expect(manifest.spec?.securityContext?.fsGroup).toBe(WORKSPACE_FS_GROUP);
  });

  it("preserves Phase 3 labels and managed-by metadata when the volume is added", () => {
    const manifest = buildSessionPodManifest(spec);
    expect(manifest.metadata?.labels).toEqual({
      [SESSION_LABEL]: spec.sessionId,
      [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
    });
  });
});

describe("buildSessionPodManifest (Phase 4.2: git-clone init container)", () => {
  const baseSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: "nginx:alpine",
    repo: "https://github.com/example/x",
  };

  it("declares a git-clone initContainer with the pinned alpine/git image", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const init = manifest.spec?.initContainers?.[0];
    expect(init?.name).toBe(GIT_CLONE_CONTAINER_NAME);
    expect(init?.image).toBe(GIT_CLONE_IMAGE);
  });

  it("passes REPO_URL and BRANCH as plain env values, GIT_TOKEN via Secret ref", () => {
    const manifest = buildSessionPodManifest({ ...baseSpec, branch: "develop" });
    const env = manifest.spec?.initContainers?.[0]?.env ?? [];
    const repoEnv = env.find((e) => e.name === "REPO_URL");
    const branchEnv = env.find((e) => e.name === "BRANCH");
    const tokenEnv = env.find((e) => e.name === "GIT_TOKEN");

    expect(repoEnv?.value).toBe("https://github.com/example/x");
    expect(branchEnv?.value).toBe("develop");
    expect(tokenEnv?.value).toBeUndefined();
    expect(tokenEnv?.valueFrom?.secretKeyRef).toEqual({
      name: GIT_CREDS_SECRET_NAME,
      key: GIT_CREDS_SECRET_KEY,
    });
  });

  it("defaults BRANCH to `main` when the spec omits branch", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const env = manifest.spec?.initContainers?.[0]?.env ?? [];
    expect(env.find((e) => e.name === "BRANCH")?.value).toBe(DEFAULT_BRANCH);
  });

  it("mounts the workspace volume into the init container at /workspace", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const mounts = manifest.spec?.initContainers?.[0]?.volumeMounts ?? [];
    expect(mounts).toContainEqual({ name: WORKSPACE_VOLUME_NAME, mountPath: "/workspace" });
  });

  it("injects the token only at clone time and strips it from the persisted remote", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const cmd = manifest.spec?.initContainers?.[0]?.command ?? [];
    const script = cmd[cmd.length - 1] ?? "";
    expect(script).toContain("x-access-token:${GIT_TOKEN}");
    expect(script).toContain("git -C /workspace/repo remote set-url origin");
    // The clone URL is built per-invocation, never persisted to .git/config
    expect(script).not.toMatch(/\.git\/config.*GIT_TOKEN/);
  });

  it("does not expose GIT_TOKEN to the main container", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const mainEnv = manifest.spec?.containers?.[0]?.env ?? [];
    expect(mainEnv.find((e) => e.name === "GIT_TOKEN")).toBeUndefined();
  });
});

describe("buildSessionPodManifest (Phase 4.3: annotations + activeDeadlineSeconds)", () => {
  const baseSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: "nginx:alpine",
    repo: "https://github.com/example/x",
    branch: "develop",
    createdAt: "2026-05-03T22:00:00.000Z",
  };

  it("writes openvoid.io/{repo,branch,created-at} annotations", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const annotations = manifest.metadata?.annotations ?? {};
    expect(annotations[REPO_ANNOTATION]).toBe("https://github.com/example/x");
    expect(annotations[BRANCH_ANNOTATION]).toBe("develop");
    expect(annotations[CREATED_AT_ANNOTATION]).toBe("2026-05-03T22:00:00.000Z");
  });

  it("falls back to `main` for the branch annotation when branch is omitted", () => {
    const manifest = buildSessionPodManifest({ ...baseSpec, branch: undefined });
    expect(manifest.metadata?.annotations?.[BRANCH_ANNOTATION]).toBe(DEFAULT_BRANCH);
  });

  it("generates a current RFC 3339 createdAt when one is not provided", () => {
    const before = new Date().toISOString();
    const manifest = buildSessionPodManifest({ ...baseSpec, createdAt: undefined });
    const after = new Date().toISOString();
    const value = manifest.metadata?.annotations?.[CREATED_AT_ANNOTATION] ?? "";
    expect(value >= before && value <= after, `createdAt=${value}`).toBe(true);
  });

  it("sets the 4-hour activeDeadlineSeconds failsafe", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    expect(manifest.spec?.activeDeadlineSeconds).toBe(ACTIVE_DEADLINE_SECONDS);
    expect(ACTIVE_DEADLINE_SECONDS).toBe(14400);
  });
});

describe("buildSessionPodManifest (Phase 5.1: git-finalizer native sidecar)", () => {
  const baseSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: "nginx:alpine",
    repo: "https://github.com/example/x",
  };

  it("declares git-finalizer as a native sidecar (initContainer with restartPolicy=Always)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const inits = manifest.spec?.initContainers ?? [];
    const finalizer = inits.find((c) => c.name === GIT_FINALIZER_CONTAINER_NAME);
    expect(finalizer, "git-finalizer initContainer should be present").toBeDefined();
    // Native sidecar pattern: initContainer with restartPolicy=Always runs alongside main.
    expect((finalizer as { restartPolicy?: string }).restartPolicy).toBe("Always");
  });

  it("keeps git-clone as a non-restarting initContainer alongside the finalizer", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const inits = manifest.spec?.initContainers ?? [];
    const clone = inits.find((c) => c.name === GIT_CLONE_CONTAINER_NAME);
    expect(clone).toBeDefined();
    expect((clone as { restartPolicy?: string }).restartPolicy).toBeUndefined();
  });

  it("uses the pinned alpine/git image for the finalizer", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_FINALIZER_CONTAINER_NAME,
    );
    expect(finalizer?.image).toBe(GIT_FINALIZER_IMAGE);
  });

  it("mounts the workspace volume into the finalizer at /workspace", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_FINALIZER_CONTAINER_NAME,
    );
    expect(finalizer?.volumeMounts).toContainEqual({
      name: WORKSPACE_VOLUME_NAME,
      mountPath: "/workspace",
    });
  });

  it("mounts the git-creds Secret into the finalizer at /etc/git-creds (read-only)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const volumes = manifest.spec?.volumes ?? [];
    const credsVolume = volumes.find((v) => v.name === GIT_CREDS_VOLUME_NAME);
    expect(credsVolume?.secret?.secretName).toBe(GIT_CREDS_SECRET_NAME);

    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_FINALIZER_CONTAINER_NAME,
    );
    expect(finalizer?.volumeMounts).toContainEqual({
      name: GIT_CREDS_VOLUME_NAME,
      mountPath: GIT_CREDS_MOUNT_PATH,
      readOnly: true,
    });
  });

  it("wires BRANCH (plain) and GIT_TOKEN (secretKeyRef) on the finalizer", () => {
    const manifest = buildSessionPodManifest({ ...baseSpec, branch: "develop" });
    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_FINALIZER_CONTAINER_NAME,
    );
    const env = finalizer?.env ?? [];
    expect(env.find((e) => e.name === "BRANCH")?.value).toBe("develop");

    const tokenEnv = env.find((e) => e.name === "GIT_TOKEN");
    expect(tokenEnv?.value).toBeUndefined();
    expect(tokenEnv?.valueFrom?.secretKeyRef).toEqual({
      name: GIT_CREDS_SECRET_NAME,
      key: GIT_CREDS_SECRET_KEY,
    });
  });

  it("defaults BRANCH to `main` on the finalizer when the spec omits branch", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_FINALIZER_CONTAINER_NAME,
    );
    const env = finalizer?.env ?? [];
    expect(env.find((e) => e.name === "BRANCH")?.value).toBe(DEFAULT_BRANCH);
  });

  it("does NOT mount git-creds on the main container (credential isolation)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const main = manifest.spec?.containers?.[0];
    const mounts = main?.volumeMounts ?? [];
    expect(mounts.find((m) => m.name === GIT_CREDS_VOLUME_NAME)).toBeUndefined();
    const env = main?.env ?? [];
    expect(env.find((e) => e.name === "GIT_TOKEN")).toBeUndefined();
  });
});

describe("buildSessionPodManifest (Phase 5.2: terminationGracePeriodSeconds)", () => {
  const baseSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: "nginx:alpine",
    repo: "https://github.com/example/x",
  };

  it("sets terminationGracePeriodSeconds to 180 by default", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    expect(manifest.spec?.terminationGracePeriodSeconds).toBe(TERMINATION_GRACE_PERIOD_SECONDS);
    expect(TERMINATION_GRACE_PERIOD_SECONDS).toBe(180);
  });
});

describe("sessionsRouter", () => {
  let ops: ReturnType<typeof makeMockOps>;
  let app: ReturnType<typeof sessionsRouter>;

  beforeEach(() => {
    ops = makeMockOps();
    app = sessionsRouter(ops);
  });

  describe("POST /sessions", () => {
    it("creates a pod with the expected labels and image and returns 201", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "https://github.com/example/x" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("Pending");
      expect(typeof body.sessionId).toBe("string");
      expect(body.sessionId).toHaveLength(26);

      expect(ops.createSessionPod).toHaveBeenCalledOnce();
      const arg = ops.createSessionPod.mock.calls[0][0] as SessionPodSpec;
      expect(arg.image).toBe("nginx:alpine");
      expect(arg.repo).toBe("https://github.com/example/x");
      expect(arg.branch).toBeUndefined();
      const manifest = buildSessionPodManifest(arg);
      expect(manifest.metadata?.labels).toEqual({
        [SESSION_LABEL]: arg.sessionId,
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      });
      expect(manifest.spec?.containers?.[0]?.image).toBe("nginx:alpine");
    });

    it("threads `branch` from the request body into the pod spec", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: "https://github.com/example/x",
          branch: "develop",
        }),
      });
      expect(res.status).toBe(201);
      const arg = ops.createSessionPod.mock.calls[0][0] as SessionPodSpec;
      expect(arg.branch).toBe("develop");
    });

    it("rejects empty `branch` string with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "https://github.com/example/x", branch: "" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_request");
    });

    it("rejects non-string `branch` with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "https://github.com/example/x", branch: 42 }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects malformed JSON with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_body");
    });

    it("rejects body missing `repo` with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idleTimeoutSeconds: 60 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_request");
    });

    it("rejects empty `repo` string with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_request");
    });

    it("rejects non-HTTPS `repo` URLs (SSH, http, plain string) with 400", async () => {
      const cases = [
        "git@github.com:example/x.git",
        "http://github.com/example/x",
        "ssh://git@github.com/example/x",
        "git://github.com/example/x",
        "github.com/example/x",
        "/local/path",
      ];
      for (const repo of cases) {
        const res = await app.request("/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo }),
        });
        expect(res.status, `repo=${repo}`).toBe(400);
        const body = await res.json();
        expect(body.code).toBe("invalid_request");
        expect(body.message).toContain("HTTPS");
      }
      expect(ops.createSessionPod).not.toHaveBeenCalled();
    });

    it("rejects negative idleTimeoutSeconds with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "https://github.com/example/x", idleTimeoutSeconds: -1 }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects non-finite idleTimeoutSeconds (NaN, Infinity) with 400", async () => {
      for (const v of ["NaN", "Infinity"]) {
        const res = await app.request("/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // JSON cannot encode NaN/Infinity; serialize the literal text instead.
          body: `{"repo":"https://github.com/example/x","idleTimeoutSeconds":${v}}`,
        });
        expect(res.status, `value=${v}`).toBe(400);
      }
    });

    it("accepts valid positive idleTimeoutSeconds", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "https://github.com/example/x", idleTimeoutSeconds: 600 }),
      });
      expect(res.status).toBe(201);
    });

    it("returns 503 when the K8s client throws", async () => {
      ops.createSessionPod.mockRejectedValueOnce(new Error("apiserver unreachable"));
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "https://github.com/example/x" }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("k8s_unavailable");
      expect(body.message).toContain("apiserver unreachable");
    });

    it("returns 503 with a safe message when a non-Error value is thrown", async () => {
      ops.createSessionPod.mockRejectedValueOnce("just a string");
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "https://github.com/example/x" }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("k8s_unavailable");
      expect(body.message).not.toContain("undefined");
    });
  });

  describe("GET /sessions/:id", () => {
    it("returns 200 + session when the pod exists", async () => {
      ops.getSessionPod.mockResolvedValueOnce(podWith("Running", "10.244.0.5"));
      const res = await app.request("/sessions/01HABCDEF");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionId).toBe("01HABCDEF");
      expect(body.status).toBe("Running");
      expect(body.endpointUrl).toBe("http://10.244.0.5");
    });

    it("maps Succeeded → Stopped and Failed → Failed", async () => {
      ops.getSessionPod.mockResolvedValueOnce(podWith("Succeeded"));
      let res = await app.request("/sessions/x");
      expect((await res.json()).status).toBe("Stopped");

      ops.getSessionPod.mockResolvedValueOnce(podWith("Failed"));
      res = await app.request("/sessions/x");
      expect((await res.json()).status).toBe("Failed");
    });

    it("maps unknown phases (e.g. `Unknown`, `Pending`) to Pending", async () => {
      for (const phase of ["Pending", "Unknown", "CrashLoopBackOff"]) {
        ops.getSessionPod.mockResolvedValueOnce(podWith(phase));
        const res = await app.request("/sessions/x");
        expect((await res.json()).status, `phase=${phase}`).toBe("Pending");
      }
    });

    it("omits endpointUrl from the response when the pod has no IP", async () => {
      ops.getSessionPod.mockResolvedValueOnce(podWith("Running"));
      const res = await app.request("/sessions/x");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ sessionId: "x", status: "Running" });
      expect(body).not.toHaveProperty("endpointUrl");
    });

    it("returns 404 when the pod does not exist", async () => {
      ops.getSessionPod.mockResolvedValueOnce(null);
      const res = await app.request("/sessions/missing");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe("not_found");
    });

    it("populates repo, branch, createdAt from pod annotations", async () => {
      ops.getSessionPod.mockResolvedValueOnce(
        podWith("Running", "10.244.0.5", {
          [REPO_ANNOTATION]: "https://github.com/example/x",
          [BRANCH_ANNOTATION]: "develop",
          [CREATED_AT_ANNOTATION]: "2026-05-03T22:00:00.000Z",
        }),
      );
      const res = await app.request("/sessions/01HABCDEF");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.repo).toBe("https://github.com/example/x");
      expect(body.branch).toBe("develop");
      expect(body.createdAt).toBe("2026-05-03T22:00:00.000Z");
    });

    it("omits repo/branch/createdAt when annotations are absent (defensive)", async () => {
      ops.getSessionPod.mockResolvedValueOnce(podWith("Running", "10.244.0.5"));
      const res = await app.request("/sessions/01HABCDEF");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).not.toHaveProperty("repo");
      expect(body).not.toHaveProperty("branch");
      expect(body).not.toHaveProperty("createdAt");
    });

    it("returns 503 when the K8s client throws", async () => {
      ops.getSessionPod.mockRejectedValueOnce(new Error("apiserver unreachable"));
      const res = await app.request("/sessions/x");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("k8s_unavailable");
    });
  });

  describe("DELETE /sessions/:id", () => {
    it("returns 204 when the pod was deleted", async () => {
      ops.deleteSessionPod.mockResolvedValueOnce(true);
      const res = await app.request("/sessions/x", { method: "DELETE" });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    });

    it("returns 404 (not 500) when the pod does not exist", async () => {
      ops.deleteSessionPod.mockResolvedValueOnce(false);
      const res = await app.request("/sessions/missing", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("returns 503 when the K8s client throws", async () => {
      ops.deleteSessionPod.mockRejectedValueOnce(new Error("boom"));
      const res = await app.request("/sessions/x", { method: "DELETE" });
      expect(res.status).toBe(503);
    });
  });
});
