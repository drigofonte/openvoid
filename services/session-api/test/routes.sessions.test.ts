import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { V1Pod } from "@kubernetes/client-node";
import { sessionsRouter } from "../src/routes/sessions.js";
import {
  type SessionOps,
  type SessionPodSpec,
  type SessionResources,
  buildSessionPodManifest,
  buildSessionResources,
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
  OPENCODE_IMAGE,
  OPENCODE_AGENT_PORT,
  OPENCODE_AGENT_PORT_NAME,
  OPENCODE_PREVIEW_PORT,
  OPENCODE_PREVIEW_PORT_NAME,
  OPENCODE_PASSWORD_SECRET_NAME,
  OPENCODE_PASSWORD_SECRET_KEY,
  OPENCODE_AUTH_SECRET_NAME,
  OPENCODE_AUTH_SECRET_KEY,
  OPENCODE_AUTH_VOLUME_NAME,
  OPENCODE_AUTH_MOUNT_PATH,
} from "../src/k8s/client.js";

const TEST_AUTH_HEADER = "Basic b3BlbmNvZGU6dGVzdC1wYXNz"; // "opencode:test-pass"

function makeMockOps(): SessionOps & {
  createSessionResources: ReturnType<typeof vi.fn>;
  getSessionPod: ReturnType<typeof vi.fn>;
  deleteSessionResources: ReturnType<typeof vi.fn>;
} {
  return {
    createSessionResources: vi.fn(
      async (spec: SessionPodSpec): Promise<SessionResources> =>
        buildSessionResources(spec, { authHeaderValue: TEST_AUTH_HEADER }),
    ),
    getSessionPod: vi.fn(async () => null),
    deleteSessionResources: vi.fn(async () => false),
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

  it("does not override the image's ENTRYPOINT — git-clone container ships the script", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const init = manifest.spec?.initContainers?.[0];
    // The custom image (infra/images/git-clone/) bakes the script in as
    // ENTRYPOINT. Setting `command` here would shadow it.
    expect(init?.command).toBeUndefined();
    expect(init?.args).toBeUndefined();
  });

  it("does not expose GIT_TOKEN to the main container", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const mainEnv = manifest.spec?.containers?.[0]?.env ?? [];
    expect(mainEnv.find((e) => e.name === "GIT_TOKEN")).toBeUndefined();
  });
});

describe("git-clone image script (infra/images/git-clone/clone.sh)", () => {
  // The script lives in the image now (not in the manifest), so these are
  // file-content regression guards against the same risks the inline
  // version used to assert: token injection only at clone time, and an
  // explicit token-stripping `remote set-url` so the PAT never lands in
  // .git/config.
  const script = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../infra/images/git-clone/clone.sh",
    ),
    "utf8",
  );

  it("injects the token into the clone URL via the GIT_TOKEN env var", () => {
    expect(script).toContain("x-access-token:${GIT_TOKEN}");
  });

  it("rewrites origin to the clean REPO_URL after cloning (token never lands in .git/config)", () => {
    expect(script).toMatch(/git -C \/workspace\/repo remote set-url origin "\$REPO_URL"/);
    expect(script).not.toMatch(/\.git\/config.*GIT_TOKEN/);
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
    expect(finalizer?.restartPolicy).toBe("Always");
  });

  it("keeps git-clone as a non-restarting initContainer alongside the finalizer", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const inits = manifest.spec?.initContainers ?? [];
    const clone = inits.find((c) => c.name === GIT_CLONE_CONTAINER_NAME);
    expect(clone).toBeDefined();
    expect(clone?.restartPolicy).toBeUndefined();
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

  it("wires GIT_TOKEN via secretKeyRef on the finalizer (no plain-value env)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_FINALIZER_CONTAINER_NAME,
    );
    const env = finalizer?.env ?? [];

    const tokenEnv = env.find((e) => e.name === "GIT_TOKEN");
    expect(tokenEnv?.value).toBeUndefined();
    expect(tokenEnv?.valueFrom?.secretKeyRef).toEqual({
      name: GIT_CREDS_SECRET_NAME,
      key: GIT_CREDS_SECRET_KEY,
    });
  });

  it("does not wire BRANCH on the finalizer (entrypoint derives the push branch from HOSTNAME)", () => {
    const manifest = buildSessionPodManifest({ ...baseSpec, branch: "develop" });
    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_FINALIZER_CONTAINER_NAME,
    );
    const env = finalizer?.env ?? [];
    expect(env.find((e) => e.name === "BRANCH")).toBeUndefined();
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

describe("buildSessionPodManifest (Phase 6.2: OpenCode main container + Secrets)", () => {
  const baseSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: OPENCODE_IMAGE,
    repo: "https://github.com/example/x",
  };

  it("declares the agent-http port at 8080 on the main container", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const ports = manifest.spec?.containers?.[0]?.ports ?? [];
    expect(ports).toContainEqual({
      name: OPENCODE_AGENT_PORT_NAME,
      containerPort: OPENCODE_AGENT_PORT,
    });
    expect(OPENCODE_AGENT_PORT_NAME).toBe("agent-http");
    expect(OPENCODE_AGENT_PORT).toBe(8080);
  });

  it("disables ServiceAccount token automounting on the pod", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    expect(manifest.spec?.automountServiceAccountToken).toBe(false);
  });

  it("wires OPENCODE_SERVER_PASSWORD via secretKeyRef on the main container", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const env = manifest.spec?.containers?.[0]?.env ?? [];
    const passwordEnv = env.find((e) => e.name === "OPENCODE_SERVER_PASSWORD");
    expect(passwordEnv?.value).toBeUndefined();
    expect(passwordEnv?.valueFrom?.secretKeyRef).toEqual({
      name: OPENCODE_PASSWORD_SECRET_NAME,
      key: OPENCODE_PASSWORD_SECRET_KEY,
    });
  });

  it("declares the opencode-auth Secret as a pod-level volume with subPath projection", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const volumes = manifest.spec?.volumes ?? [];
    const authVolume = volumes.find((v) => v.name === OPENCODE_AUTH_VOLUME_NAME);
    expect(authVolume?.secret?.secretName).toBe(OPENCODE_AUTH_SECRET_NAME);
    expect(authVolume?.secret?.items).toEqual([
      { key: OPENCODE_AUTH_SECRET_KEY, path: OPENCODE_AUTH_SECRET_KEY },
    ]);
    // 0o400 = 256 — owner-read-only at file level (defense in depth on
    // top of the read-only mount).
    expect(authVolume?.secret?.defaultMode).toBe(0o400);
  });

  it("mounts opencode-auth on the main container at the XDG-pinned auth path (subPath, read-only)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const main = manifest.spec?.containers?.[0];
    expect(main?.volumeMounts).toContainEqual({
      name: OPENCODE_AUTH_VOLUME_NAME,
      mountPath: OPENCODE_AUTH_MOUNT_PATH,
      subPath: OPENCODE_AUTH_SECRET_KEY,
      readOnly: true,
    });
    // Path matches the image's ENV XDG_DATA_HOME (Unit 6.1 Dockerfile).
    expect(OPENCODE_AUTH_MOUNT_PATH).toBe(
      "/var/opencode-data/opencode/auth.json",
    );
  });

  it("does NOT mount opencode-auth on the git-clone init container (LLM-auth isolation)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const clone = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_CLONE_CONTAINER_NAME,
    );
    const mounts = clone?.volumeMounts ?? [];
    expect(mounts.find((m) => m.name === OPENCODE_AUTH_VOLUME_NAME)).toBeUndefined();
    const env = clone?.env ?? [];
    expect(env.find((e) => e.name === "OPENCODE_SERVER_PASSWORD")).toBeUndefined();
  });

  it("does NOT mount opencode-auth on the git-finalizer sidecar (LLM-auth isolation)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === GIT_FINALIZER_CONTAINER_NAME,
    );
    const mounts = finalizer?.volumeMounts ?? [];
    expect(mounts.find((m) => m.name === OPENCODE_AUTH_VOLUME_NAME)).toBeUndefined();
    const env = finalizer?.env ?? [];
    expect(env.find((e) => e.name === "OPENCODE_SERVER_PASSWORD")).toBeUndefined();
  });

  it("re-asserts: main container does NOT mount git-creds (Phase 5 invariant carries forward)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const main = manifest.spec?.containers?.[0];
    const mounts = main?.volumeMounts ?? [];
    expect(mounts.find((m) => m.name === GIT_CREDS_VOLUME_NAME)).toBeUndefined();
    const env = main?.env ?? [];
    expect(env.find((e) => e.name === "GIT_TOKEN")).toBeUndefined();
  });

  it("mounts the workspace volume on the main container at /workspace (matches OpenCode WORKDIR /workspace/repo)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const mounts = manifest.spec?.containers?.[0]?.volumeMounts ?? [];
    expect(mounts).toContainEqual({
      name: WORKSPACE_VOLUME_NAME,
      mountPath: WORKSPACE_MOUNT_PATH,
    });
    expect(WORKSPACE_MOUNT_PATH).toBe("/workspace");
  });

  it("preserves the OPENVOID_STUB_IMAGE override path: stub image gets the same OpenCode-shaped manifest", () => {
    // Phase 5 demo flow with nginx as the main container still receives
    // the OpenCode env wiring and auth mount — they're inert on nginx
    // (it ignores the env), and structural invariance keeps the tests
    // simple. The pod still requires both Secrets to be present even
    // in stub mode; that's the documented precondition.
    const stubSpec: SessionPodSpec = { ...baseSpec, image: "nginx:alpine" };
    const manifest = buildSessionPodManifest(stubSpec);
    expect(manifest.spec?.containers?.[0]?.image).toBe("nginx:alpine");
    const env = manifest.spec?.containers?.[0]?.env ?? [];
    expect(env.find((e) => e.name === "OPENCODE_SERVER_PASSWORD")).toBeDefined();
    const mounts = manifest.spec?.containers?.[0]?.volumeMounts ?? [];
    expect(mounts.find((m) => m.name === OPENCODE_AUTH_VOLUME_NAME)).toBeDefined();
  });
});

describe("buildSessionPodManifest (Phase 7.2: preview port on main container)", () => {
  const baseSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: OPENCODE_IMAGE,
    repo: "https://github.com/example/x",
  };

  it("declares the preview-http port at 3000 alongside agent-http", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const ports = manifest.spec?.containers?.[0]?.ports ?? [];
    expect(ports).toContainEqual({
      name: OPENCODE_PREVIEW_PORT_NAME,
      containerPort: OPENCODE_PREVIEW_PORT,
    });
    expect(OPENCODE_PREVIEW_PORT_NAME).toBe("preview-http");
    expect(OPENCODE_PREVIEW_PORT).toBe(3000);
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
    it("creates a pod with the expected labels and OpenCode image and returns 201", async () => {
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

      expect(ops.createSessionResources).toHaveBeenCalledOnce();
      const arg = ops.createSessionResources.mock.calls[0][0] as SessionPodSpec;
      expect(arg.image).toBe(OPENCODE_IMAGE);
      expect(arg.repo).toBe("https://github.com/example/x");
      expect(arg.branch).toBeUndefined();
      const manifest = buildSessionPodManifest(arg);
      expect(manifest.metadata?.labels).toEqual({
        [SESSION_LABEL]: arg.sessionId,
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      });
      expect(manifest.spec?.containers?.[0]?.image).toBe(OPENCODE_IMAGE);
    });

    it("honours OPENVOID_STUB_IMAGE override (Phase 5 demo path stays reproducible)", async () => {
      vi.stubEnv("OPENVOID_STUB_IMAGE", "nginx:alpine");
      try {
        const res = await app.request("/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: "https://github.com/example/x" }),
        });
        expect(res.status).toBe(201);
        const arg = ops.createSessionResources.mock.calls[0][0] as SessionPodSpec;
        expect(arg.image).toBe("nginx:alpine");
      } finally {
        vi.unstubAllEnvs();
      }
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
      const arg = ops.createSessionResources.mock.calls[0][0] as SessionPodSpec;
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
      expect(ops.createSessionResources).not.toHaveBeenCalled();
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
      ops.createSessionResources.mockRejectedValueOnce(new Error("apiserver unreachable"));
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
      ops.createSessionResources.mockRejectedValueOnce("just a string");
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
      // endpointUrl depends on podIP and is omitted; agent/preview URLs
      // depend only on status=Running and are present (Unit 7.3).
      expect(body).not.toHaveProperty("endpointUrl");
      expect(body.sessionId).toBe("x");
      expect(body.status).toBe("Running");
    });

    it("returns 404 when the pod does not exist", async () => {
      ops.getSessionPod.mockResolvedValueOnce(null);
      const res = await app.request("/sessions/missing");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe("not_found");
    });

    it("populates agentUrl and previewUrl when status is Running (Unit 7.3)", async () => {
      ops.getSessionPod.mockResolvedValueOnce(podWith("Running", "10.244.0.5"));
      const res = await app.request("/sessions/01HABCDEF");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agentUrl).toBe("http://01habcdef.agent.127.0.0.1.nip.io/");
      expect(body.previewUrl).toBe("http://01habcdef.preview.127.0.0.1.nip.io/");
    });

    it("omits agentUrl / previewUrl when status is not Running (Unit 7.3)", async () => {
      // Pending → no URL surfaced (routing isn't ready).
      for (const phase of ["Pending", "Unknown", "Failed", "Succeeded"]) {
        ops.getSessionPod.mockResolvedValueOnce(podWith(phase));
        const res = await app.request("/sessions/x");
        const body = await res.json();
        expect(body, `phase=${phase}`).not.toHaveProperty("agentUrl");
        expect(body, `phase=${phase}`).not.toHaveProperty("previewUrl");
      }
    });

    it("respects OPENVOID_DOMAIN_BASE + OPENVOID_URL_SCHEME for URL synthesis (Unit 7.3)", async () => {
      vi.stubEnv("OPENVOID_DOMAIN_BASE", "foo.example.com");
      vi.stubEnv("OPENVOID_URL_SCHEME", "https");
      try {
        ops.getSessionPod.mockResolvedValueOnce(podWith("Running", "10.244.0.5"));
        const res = await app.request("/sessions/01HABCDEF");
        const body = await res.json();
        expect(body.agentUrl).toBe("https://01habcdef.agent.foo.example.com/");
        expect(body.previewUrl).toBe("https://01habcdef.preview.foo.example.com/");
      } finally {
        vi.unstubAllEnvs();
      }
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
      ops.deleteSessionResources.mockResolvedValueOnce(true);
      const res = await app.request("/sessions/x", { method: "DELETE" });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    });

    it("returns 404 (not 500) when the pod does not exist", async () => {
      ops.deleteSessionResources.mockResolvedValueOnce(false);
      const res = await app.request("/sessions/missing", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("returns 503 when the K8s client throws", async () => {
      ops.deleteSessionResources.mockRejectedValueOnce(new Error("boom"));
      const res = await app.request("/sessions/x", { method: "DELETE" });
      expect(res.status).toBe(503);
    });
  });
});
