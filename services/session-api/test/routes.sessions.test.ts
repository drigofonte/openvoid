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
  WORKSPACE_INIT_CONTAINER_NAME,
  WORKSPACE_INIT_IMAGE,
  DEFAULT_SCAFFOLD_TEMPLATE_URL,
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
    // Phase 7 follow-up: the emptyDir gains a sizeLimit cap. Asserted
    // in detail in the resource-budget describe block; the original
    // intent here is just "this is an emptyDir, not a PVC".
    expect(workspace?.emptyDir).toBeDefined();
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

describe("buildSessionPodManifest (Phase 4.2: workspace-init container)", () => {
  const baseSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: "nginx:alpine",
    repo: "https://github.com/example/x",
  };

  it("declares a workspace-init initContainer with the pinned alpine/git image", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const init = manifest.spec?.initContainers?.[0];
    expect(init?.name).toBe(WORKSPACE_INIT_CONTAINER_NAME);
    expect(init?.image).toBe(WORKSPACE_INIT_IMAGE);
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

  it("does not override the image's ENTRYPOINT — workspace-init container ships the script", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const init = manifest.spec?.initContainers?.[0];
    // The custom image (infra/images/workspace-init/) bakes the script
    // in as ENTRYPOINT. Setting `command` here would shadow it.
    expect(init?.command).toBeUndefined();
    expect(init?.args).toBeUndefined();
  });

  it("does not expose GIT_TOKEN to the main container", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const mainEnv = manifest.spec?.containers?.[0]?.env ?? [];
    expect(mainEnv.find((e) => e.name === "GIT_TOKEN")).toBeUndefined();
  });
});

describe("workspace-init image script (infra/images/workspace-init/init.sh)", () => {
  // The script lives in the image now (not in the manifest), so these
  // are file-content regression guards against the same risks the
  // inline version used to assert: token injection only at push/clone
  // time, and an explicit clean origin so the PAT never lands in
  // .git/config. After U7 the same guards apply across both boot
  // paths (import-repo and new-app).
  const script = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../infra/images/workspace-init/init.sh",
    ),
    "utf8",
  );

  it("branches on OPENVOID_NEW_APP between run_new_app and run_import_repo", () => {
    expect(script).toMatch(/run_new_app\(\)/);
    expect(script).toMatch(/run_import_repo\(\)/);
    expect(script).toMatch(/OPENVOID_NEW_APP/);
  });

  it("injects the token into the URL via the GIT_TOKEN env var (both branches)", () => {
    // Once for import-repo's clone, once for new-app's push.
    const matches = script.match(/x-access-token:\$\{GIT_TOKEN\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("import-repo branch rewrites origin to the clean REPO_URL after cloning (token never lands in .git/config)", () => {
    expect(script).toMatch(/git -C "\$REPO_DIR" remote set-url origin "\$REPO_URL"/);
    expect(script).not.toMatch(/\.git\/config.*GIT_TOKEN/);
  });

  it("new-app branch never persists the token: remote add origin uses REPO_URL, the push uses auth_url directly, and `-u` is omitted to keep the token out of stdout", () => {
    expect(script).toMatch(/git remote add origin "\$REPO_URL"/);
    // Push uses the auth_url; `-u` is deliberately omitted because
    // git's auto-printed "branch 'main' set up to track '<upstream>'"
    // line would expose the full auth_url (token included) to
    // container stdout, which lands in kubectl logs.
    expect(script).toMatch(/git push "\$auth_url" main/);
    expect(script).not.toMatch(/git push -u/);
    // Negative: no live git invocation of `set-url` with auth_url
    // would persist the credential into .git/config. Strip comment
    // lines first so the explanatory note in the script doesn't
    // false-positive.
    const live = script
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(live).not.toMatch(/remote set-url[^\n]*auth_url/);
  });

  it("new-app branch strips the scaffold's history before re-initialising", () => {
    expect(script).toMatch(/rm -rf "\$REPO_DIR\/\.git"/);
    expect(script).toMatch(/git init -q -b main/);
  });

  it("new-app branch writes app/scaffold-meta.json with prompt + createdAt + scaffoldVersion", () => {
    expect(script).toContain("scaffold-meta.json");
    expect(script).toMatch(/"prompt": "%s"/);
    expect(script).toMatch(/"createdAt": "%s"/);
    expect(script).toMatch(/"scaffoldVersion": "%s"/);
  });

  it("new-app branch runs pnpm install --frozen-lockfile after the seed push", () => {
    expect(script).toMatch(/pnpm install --frozen-lockfile/);
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

  it("keeps workspace-init as a non-restarting initContainer alongside the finalizer", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const inits = manifest.spec?.initContainers ?? [];
    const init = inits.find((c) => c.name === WORKSPACE_INIT_CONTAINER_NAME);
    expect(init).toBeDefined();
    expect(init?.restartPolicy).toBeUndefined();
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

  it("does NOT mount opencode-auth on the workspace-init container (LLM-auth isolation)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const init = manifest.spec?.initContainers?.find(
      (c) => c.name === WORKSPACE_INIT_CONTAINER_NAME,
    );
    const mounts = init?.volumeMounts ?? [];
    expect(mounts.find((m) => m.name === OPENCODE_AUTH_VOLUME_NAME)).toBeUndefined();
    const env = init?.env ?? [];
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

describe("buildSessionPodManifest (Phase 7 follow-up: per-session resource budget)", () => {
  const baseSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: OPENCODE_IMAGE,
    repo: "https://github.com/example/x",
  };

  it("caps the workspace emptyDir at 10Gi (prevents node-disk exhaustion)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const workspace = manifest.spec?.volumes?.find(
      (v) => v.name === WORKSPACE_VOLUME_NAME,
    );
    expect(workspace?.emptyDir?.sizeLimit).toBe("10Gi");
  });

  it("gives the main session container Guaranteed-QoS memory (request === limit === 1Gi) and a 1-vCPU cap", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const main = manifest.spec?.containers?.[0];
    expect(main?.resources?.requests).toEqual({ cpu: "100m", memory: "1Gi" });
    expect(main?.resources?.limits).toEqual({ cpu: "1000m", memory: "1Gi" });
  });

  it("sizes workspace-init for the pnpm-install peak (1 GiB ceiling) and git-finalizer for its idle-then-push lifecycle (128 MiB ceiling)", () => {
    const manifest = buildSessionPodManifest(baseSpec);
    const inits = manifest.spec?.initContainers ?? [];

    const workspaceInit = inits.find((c) => c.name === "workspace-init");
    expect(workspaceInit?.resources?.requests).toEqual({ cpu: "100m", memory: "256Mi" });
    expect(workspaceInit?.resources?.limits).toEqual({ cpu: "500m", memory: "1Gi" });

    const finalizer = inits.find((c) => c.name === "git-finalizer");
    expect(finalizer?.resources?.requests).toEqual({ cpu: "50m", memory: "64Mi" });
    expect(finalizer?.resources?.limits).toEqual({ cpu: "200m", memory: "128Mi" });
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

describe("buildSessionPodManifest (U6: new-app branch)", () => {
  const newAppSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: OPENCODE_IMAGE,
    repo: "https://github.com/openvoid-platform/ai-flashcards-x7f2k9.git",
    isNewApp: true,
    prompt: "AI flashcards",
    scaffoldTemplate: "https://github.com/openvoid-platform/scaffold-react-rr7.git",
  };

  it("sets OPENVOID_NEW_APP, SCAFFOLD_TEMPLATE_URL, SCAFFOLD_PROMPT, REPO_URL on workspace-init", () => {
    const manifest = buildSessionPodManifest(newAppSpec);
    const init = manifest.spec?.initContainers?.find(
      (c) => c.name === "workspace-init",
    );
    const env = init?.env ?? [];
    expect(env.find((e) => e.name === "OPENVOID_NEW_APP")?.value).toBe("true");
    expect(env.find((e) => e.name === "SCAFFOLD_TEMPLATE_URL")?.value).toBe(
      "https://github.com/openvoid-platform/scaffold-react-rr7.git",
    );
    expect(env.find((e) => e.name === "SCAFFOLD_PROMPT")?.value).toBe("AI flashcards");
    expect(env.find((e) => e.name === "REPO_URL")?.value).toBe(
      "https://github.com/openvoid-platform/ai-flashcards-x7f2k9.git",
    );
  });

  it("sources GIT_TOKEN from github-platform-creds (not git-creds) on workspace-init in new-app mode", () => {
    const manifest = buildSessionPodManifest(newAppSpec);
    const init = manifest.spec?.initContainers?.find(
      (c) => c.name === "workspace-init",
    );
    const tokenEnv = init?.env?.find((e) => e.name === "GIT_TOKEN");
    expect(tokenEnv?.valueFrom?.secretKeyRef).toEqual({
      name: "github-platform-creds",
      key: "token",
    });
  });

  it("sources GIT_TOKEN from github-platform-creds on git-finalizer in new-app mode", () => {
    const manifest = buildSessionPodManifest(newAppSpec);
    const finalizer = manifest.spec?.initContainers?.find(
      (c) => c.name === "git-finalizer",
    );
    const tokenEnv = finalizer?.env?.find((e) => e.name === "GIT_TOKEN");
    expect(tokenEnv?.valueFrom?.secretKeyRef).toEqual({
      name: "github-platform-creds",
      key: "token",
    });
  });

  it("swaps the Pod-level git-creds volume to mount github-platform-creds in new-app mode", () => {
    const manifest = buildSessionPodManifest(newAppSpec);
    const volume = manifest.spec?.volumes?.find((v) => v.name === GIT_CREDS_VOLUME_NAME);
    expect(volume?.secret?.secretName).toBe("github-platform-creds");
  });

  it("does NOT expose new-app env vars when isNewApp is unset (import-repo backwards-compat)", () => {
    const importSpec: SessionPodSpec = {
      sessionId: "01HABCDEF",
      image: OPENCODE_IMAGE,
      repo: "https://github.com/example/x",
    };
    const manifest = buildSessionPodManifest(importSpec);
    const init = manifest.spec?.initContainers?.find(
      (c) => c.name === "workspace-init",
    );
    const env = init?.env ?? [];
    expect(env.find((e) => e.name === "OPENVOID_NEW_APP")).toBeUndefined();
    expect(env.find((e) => e.name === "SCAFFOLD_TEMPLATE_URL")).toBeUndefined();
    expect(env.find((e) => e.name === "SCAFFOLD_PROMPT")).toBeUndefined();
    // Secret stays git-creds in import-repo mode.
    expect(init?.env?.find((e) => e.name === "GIT_TOKEN")?.valueFrom?.secretKeyRef?.name).toBe(
      "git-creds",
    );
  });

  it("emits SCAFFOLD_PROMPT='' when prompt is omitted", () => {
    const manifest = buildSessionPodManifest({ ...newAppSpec, prompt: undefined });
    const init = manifest.spec?.initContainers?.find(
      (c) => c.name === "workspace-init",
    );
    expect(init?.env?.find((e) => e.name === "SCAFFOLD_PROMPT")?.value).toBe("");
  });

  it("falls back to the default SCAFFOLD_TEMPLATE_URL when spec omits scaffoldTemplate", () => {
    const manifest = buildSessionPodManifest({ ...newAppSpec, scaffoldTemplate: undefined });
    const init = manifest.spec?.initContainers?.find(
      (c) => c.name === "workspace-init",
    );
    const url = init?.env?.find((e) => e.name === "SCAFFOLD_TEMPLATE_URL")?.value ?? "";
    // Asserting against the exported constant (not a string literal)
    // so operator-tunable changes to DEFAULT_SCAFFOLD_TEMPLATE_URL
    // don't drift the test.
    expect(url).toBe(DEFAULT_SCAFFOLD_TEMPLATE_URL);
  });

  it("preserves the credential-mount discipline: agent main container still has no GIT_TOKEN env even in new-app mode", () => {
    const manifest = buildSessionPodManifest(newAppSpec);
    const main = manifest.spec?.containers?.[0];
    const mainEnv = main?.env ?? [];
    // GIT_TOKEN is the load-bearing credential isolation guard — the
    // agent must not see it. OPENVOID_NEW_APP is a non-credential
    // mode flag that U8 deliberately plumbs onto the agent container
    // to drive its dual-process entrypoint; that one is allowed.
    expect(mainEnv.find((e) => e.name === "GIT_TOKEN")).toBeUndefined();
  });
});

describe("buildSessionPodManifest (U8: agent dual-process + readinessProbe)", () => {
  const newAppSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: OPENCODE_IMAGE,
    repo: "https://github.com/openvoid-platform/x-aaaaaa.git",
    isNewApp: true,
    prompt: "a",
  };
  const importRepoSpec: SessionPodSpec = {
    sessionId: "01HABCDEF",
    image: OPENCODE_IMAGE,
    repo: "https://github.com/example/x",
  };

  it("sets OPENVOID_NEW_APP=true on the agent container in new-app mode (drives entrypoint dual-process branch)", () => {
    const manifest = buildSessionPodManifest(newAppSpec);
    const main = manifest.spec?.containers?.[0];
    const env = main?.env ?? [];
    expect(env.find((e) => e.name === "OPENVOID_NEW_APP")?.value).toBe("true");
  });

  it("omits OPENVOID_NEW_APP on the agent container in import-repo mode (single-process branch)", () => {
    const manifest = buildSessionPodManifest(importRepoSpec);
    const main = manifest.spec?.containers?.[0];
    const env = main?.env ?? [];
    expect(env.find((e) => e.name === "OPENVOID_NEW_APP")).toBeUndefined();
  });

  it("attaches a readinessProbe (httpGet :3000/, init=5, period=3, threshold=30) on the agent container in new-app mode", () => {
    const manifest = buildSessionPodManifest(newAppSpec);
    const main = manifest.spec?.containers?.[0];
    expect(main?.readinessProbe).toBeDefined();
    expect(main?.readinessProbe?.httpGet?.port).toBe(OPENCODE_PREVIEW_PORT);
    expect(main?.readinessProbe?.httpGet?.path).toBe("/");
    expect(main?.readinessProbe?.initialDelaySeconds).toBe(5);
    expect(main?.readinessProbe?.periodSeconds).toBe(3);
    expect(main?.readinessProbe?.timeoutSeconds).toBe(2);
    expect(main?.readinessProbe?.failureThreshold).toBe(30);
  });

  it("does NOT attach a readinessProbe in import-repo mode (no pre-started dev server to probe)", () => {
    const manifest = buildSessionPodManifest(importRepoSpec);
    const main = manifest.spec?.containers?.[0];
    expect(main?.readinessProbe).toBeUndefined();
  });
});

describe("opencode entrypoint script (infra/images/opencode/entrypoint.sh)", () => {
  const script = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../infra/images/opencode/entrypoint.sh",
    ),
    "utf8",
  );

  it("uses bash (process substitution + wait -n require it; node:22-alpine ships ash)", () => {
    expect(script).toMatch(/^#!\/bin\/bash/);
  });

  it("branches on OPENVOID_NEW_APP between run_new_app and run_import_repo", () => {
    expect(script).toMatch(/run_new_app\(\)/);
    expect(script).toMatch(/run_import_repo\(\)/);
    expect(script).toMatch(/OPENVOID_NEW_APP/);
  });

  it("preserves the OPENCODE_SERVER_PASSWORD precondition check (exits 1 with a clear message if unset)", () => {
    expect(script).toMatch(/OPENCODE_SERVER_PASSWORD/);
    expect(script).toMatch(/exit 1/);
  });

  it("new-app branch uses process substitution (not `| sed`) so $! captures pnpm/opencode, not sed", () => {
    expect(script).toMatch(/pnpm --dir \/workspace\/repo dev > >\(sed /);
    expect(script).toMatch(/opencode serve [^\n]*> >\(sed /);
  });

  it("new-app branch uses `wait -n` so the pod exits when the first child dies", () => {
    expect(script).toMatch(/wait -n "\$DEV_PID" "\$OPENCODE_PID"/);
  });

  it("traps SIGTERM/INT and forwards to both children in new-app mode (avoids kubelet SIGKILL on grace expiry)", () => {
    expect(script).toMatch(
      /trap 'kill -TERM "\$DEV_PID" "\$OPENCODE_PID" 2>\/dev\/null \|\| true' TERM INT/,
    );
  });

  it("preserves the explicit-command pass-through (image validation: `docker run … opencode --version`)", () => {
    expect(script).toMatch(/exec "\$@"/);
  });
});

describe("scaffold-extend agent instruction (infra/images/opencode/instructions/scaffold-extend.md)", () => {
  const md = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../infra/images/opencode/instructions/scaffold-extend.md",
    ),
    "utf8",
  );

  it("states the load-bearing 'extend, don't rebuild' rule up front", () => {
    // The sentence wraps across lines in the markdown source; collapse
    // whitespace before asserting so prose reflow doesn't break the test.
    const collapsed = md.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/extend the scaffold rather than rebuild/i);
  });

  it("references the contract surfaces the agent should treat as the starting canvas", () => {
    expect(md).toContain("app/routes/_index.tsx");
    expect(md).toContain("app/scaffold-meta.json");
    expect(md).toContain("vite.config.ts");
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
        body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x" }),
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
          body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x" }),
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
          mode: "import-repo",
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
        body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x", branch: "" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_request");
    });

    it("rejects non-string `branch` with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x", branch: 42 }),
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

    it("rejects body missing `mode` with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idleTimeoutSeconds: 60 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_request");
      expect(body.message).toContain("mode");
    });

    it("rejects unknown `mode` value with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "fork-repo", repo: "https://github.com/example/x" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_request");
    });

    it("rejects import-repo with missing `repo` (mode-conditional rule)", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "import-repo" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_request");
    });

    it("rejects new-app with a `repo` (mode-conditional rule)", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "new-app",
          repo: "https://github.com/example/x",
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_request");
      expect(ops.createSessionResources).not.toHaveBeenCalled();
    });

    it("rejects import-repo with a `prompt` (mode-conditional rule)", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "import-repo",
          repo: "https://github.com/example/x",
          prompt: "but I also want…",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects empty `repo` string with 400 (import-repo)", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "import-repo", repo: "" }),
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
          body: JSON.stringify({ mode: "import-repo", repo }),
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
        body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x", idleTimeoutSeconds: -1 }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects non-finite idleTimeoutSeconds (NaN, Infinity) with 400", async () => {
      for (const v of ["NaN", "Infinity"]) {
        const res = await app.request("/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // JSON cannot encode NaN/Infinity; serialize the literal text instead.
          body: `{"mode":"import-repo","repo":"https://github.com/example/x","idleTimeoutSeconds":${v}}`,
        });
        expect(res.status, `value=${v}`).toBe(400);
      }
    });

    it("accepts valid positive idleTimeoutSeconds", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x", idleTimeoutSeconds: 600 }),
      });
      expect(res.status).toBe(201);
    });

    it("returns 503 when the K8s client throws", async () => {
      ops.createSessionResources.mockRejectedValueOnce(new Error("apiserver unreachable"));
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x" }),
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
        body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x" }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("k8s_unavailable");
      expect(body.message).not.toContain("undefined");
    });

    it("returns 501 for new-app when the router has no newAppContext (operator hasn't run the runbook)", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "new-app", prompt: "todo list with reminders" }),
      });
      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.code).toBe("not_implemented_yet");
      expect(ops.createSessionResources).not.toHaveBeenCalled();
    });

    it("rejects new-app with a non-string `prompt` with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "new-app", prompt: 42 }),
      });
      expect(res.status).toBe(400);
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

describe("sessionsRouter (U6: new-app POST + idempotency)", () => {
  let ops: ReturnType<typeof makeMockOps>;
  let createInOrg: ReturnType<typeof vi.fn>;
  let github: { rest: { repos: { createInOrg: typeof createInOrg } } };
  let app: ReturnType<typeof sessionsRouter>;

  beforeEach(() => {
    ops = makeMockOps();
    createInOrg = vi.fn(async (params: { name: string }) => ({
      data: {
        name: params.name,
        html_url: `https://github.com/openvoid-platform/${params.name}`,
        clone_url: `https://github.com/openvoid-platform/${params.name}.git`,
      },
    }));
    github = { rest: { repos: { createInOrg } } };
    app = sessionsRouter({
      sessionOps: ops,
      newAppContext: { org: "openvoid-platform", github: github as never },
    });
  });

  it("happy path: slugifies prompt, calls createInOrg, creates pod with new-app env (AE1)", async () => {
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "abc" },
      body: JSON.stringify({ mode: "new-app", prompt: "todo list with reminders" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("Pending");
    expect(body.pendingPhase).toBe("provisioning");
    expect(body.repo).toMatch(
      /^https:\/\/github\.com\/openvoid-platform\/todo-list-with-reminders-[a-z0-9]{6}\.git$/,
    );

    expect(createInOrg).toHaveBeenCalledOnce();
    const callArg = createInOrg.mock.calls[0][0] as { org: string; name: string };
    expect(callArg.org).toBe("openvoid-platform");
    expect(callArg.name).toMatch(/^todo-list-with-reminders-[a-z0-9]{6}$/);

    expect(ops.createSessionResources).toHaveBeenCalledOnce();
    const spec = ops.createSessionResources.mock.calls[0][0] as SessionPodSpec;
    expect(spec.isNewApp).toBe(true);
    expect(spec.prompt).toBe("todo list with reminders");
    expect(spec.repo).toMatch(/^https:\/\/github\.com\/openvoid-platform\/.+\.git$/);

    const manifest = buildSessionPodManifest(spec);
    const init = manifest.spec?.initContainers?.find((c) => c.name === "workspace-init");
    const env = init?.env ?? [];
    expect(env.find((e) => e.name === "OPENVOID_NEW_APP")?.value).toBe("true");
    expect(env.find((e) => e.name === "SCAFFOLD_PROMPT")?.value).toBe("todo list with reminders");
    expect(env.find((e) => e.name === "REPO_URL")?.value).toBe(spec.repo);
  });

  it("idempotency: same key within TTL returns the cached sessionId; github called once total", async () => {
    const first = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "dedupe-1" },
      body: JSON.stringify({ mode: "new-app", prompt: "fizzbuzz" }),
    });
    const firstBody = await first.json();

    const second = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "dedupe-1" },
      body: JSON.stringify({ mode: "new-app", prompt: "fizzbuzz" }),
    });
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(firstBody);
    expect(createInOrg).toHaveBeenCalledTimes(1);
    expect(ops.createSessionResources).toHaveBeenCalledTimes(1);
  });

  it("different idempotency keys produce different sessions (random suffix yields different slugs)", async () => {
    const first = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "k1" },
      body: JSON.stringify({ mode: "new-app", prompt: "fizzbuzz" }),
    });
    const second = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "k2" },
      body: JSON.stringify({ mode: "new-app", prompt: "fizzbuzz" }),
    });
    const a = await first.json();
    const b = await second.json();
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(createInOrg).toHaveBeenCalledTimes(2);
    const names = createInOrg.mock.calls.map((call) => (call[0] as { name: string }).name);
    expect(names[0]).not.toBe(names[1]);
  });

  it("empty prompt: slug starts with `app-`, SCAFFOLD_PROMPT env is empty", async () => {
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "new-app" }),
    });
    expect(res.status).toBe(201);
    const callArg = createInOrg.mock.calls[0][0] as { name: string };
    expect(callArg.name).toMatch(/^app-[a-z0-9]{6}$/);
    const spec = ops.createSessionResources.mock.calls[0][0] as SessionPodSpec;
    const manifest = buildSessionPodManifest(spec);
    const init = manifest.spec?.initContainers?.find((c) => c.name === "workspace-init");
    expect(init?.env?.find((e) => e.name === "SCAFFOLD_PROMPT")?.value).toBe("");
  });

  it("import-repo path is preserved unchanged when the router is configured with newAppContext", async () => {
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "import-repo", repo: "https://github.com/example/x" }),
    });
    expect(res.status).toBe(201);
    expect(createInOrg).not.toHaveBeenCalled();
    const spec = ops.createSessionResources.mock.calls[0][0] as SessionPodSpec;
    expect(spec.isNewApp).toBeUndefined();
    expect(spec.repo).toBe("https://github.com/example/x");
  });

  it("GithubRateLimited → 503 with Retry-After; pod is NOT created", async () => {
    createInOrg.mockRejectedValueOnce(
      Object.assign(new Error("API rate limit exceeded"), {
        status: 403,
        response: {
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 90),
          },
        },
      }),
    );
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "new-app", prompt: "x" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("github_rate_limited");
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(ops.createSessionResources).not.toHaveBeenCalled();
  });

  it("RepoNameCollision retries up to 3x then surfaces 500 (repo_name_collision)", async () => {
    const collision = () =>
      Object.assign(new Error("name already exists on this account"), { status: 422 });
    createInOrg.mockRejectedValueOnce(collision());
    createInOrg.mockRejectedValueOnce(collision());
    createInOrg.mockRejectedValueOnce(collision());
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "new-app", prompt: "popular name" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("repo_name_collision");
    expect(createInOrg).toHaveBeenCalledTimes(3);
    expect(ops.createSessionResources).not.toHaveBeenCalled();
  });

  it("RepoNameCollision on the first attempt then succeeds → 201", async () => {
    createInOrg.mockRejectedValueOnce(
      Object.assign(new Error("name already exists on this account"), { status: 422 }),
    );
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "new-app", prompt: "ok" }),
    });
    expect(res.status).toBe(201);
    expect(createInOrg).toHaveBeenCalledTimes(2);
    expect(ops.createSessionResources).toHaveBeenCalledOnce();
  });

  it("GitHub succeeds but pod-create fails → 503 k8s_unavailable; repo orphan documented (v1)", async () => {
    ops.createSessionResources.mockRejectedValueOnce(new Error("apiserver unreachable"));
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "new-app", prompt: "test" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("k8s_unavailable");
    expect(createInOrg).toHaveBeenCalledOnce();
  });

  it("idempotency: 409 in-flight when the same key arrives while the prior call is still running", async () => {
    let resolveFirst: () => void = () => {};
    createInOrg.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () =>
            resolve({
              data: {
                name: "x-aaaaaa",
                html_url: "https://github.com/openvoid-platform/x-aaaaaa",
                clone_url: "https://github.com/openvoid-platform/x-aaaaaa.git",
              },
            });
        }),
    );
    const firstPromise = app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "race-1" },
      body: JSON.stringify({ mode: "new-app", prompt: "x" }),
    });
    // Allow the first request to enter the handler and reserve the key.
    await new Promise((r) => setImmediate(r));
    const second = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "race-1" },
      body: JSON.stringify({ mode: "new-app", prompt: "x" }),
    });
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("idempotency_in_flight");
    resolveFirst();
    const first = await firstPromise;
    expect(first.status).toBe(201);
  });
});
