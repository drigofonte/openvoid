import { CoreV1Api, KubeConfig, type V1Pod } from "@kubernetes/client-node";

export const SESSION_NAMESPACE = "openvoid-sessions";
export const SESSION_LABEL = "openvoid.io/session-id";
export const MANAGED_BY_LABEL = "openvoid.io/managed-by";
export const MANAGED_BY_VALUE = "session-api";

export const REPO_ANNOTATION = "openvoid.io/repo";
export const BRANCH_ANNOTATION = "openvoid.io/branch";
export const CREATED_AT_ANNOTATION = "openvoid.io/created-at";

export const ACTIVE_DEADLINE_SECONDS = 14400;
// Sized for the slowest realistic git push over a flaky network.
// Compass research suggests 120–300 s; 180 is a comfortable middle.
// Graduates to a chart value in Phase 7.
export const TERMINATION_GRACE_PERIOD_SECONDS = 180;

export const WORKSPACE_VOLUME_NAME = "workspace";
// Mount path on the agent main container. Matches OpenCode's WORKDIR
// (/workspace/repo) so the agent's cwd is the cloned repo. The
// initContainer (git-clone) and sidecar (git-finalizer) mount the same
// volume at /workspace and see the repo at /workspace/repo.
export const WORKSPACE_MOUNT_PATH = "/workspace";
export const WORKSPACE_FS_GROUP = 65533;

export const GIT_CLONE_IMAGE = "localhost:5001/openvoid/git-clone:dev";
export const GIT_CLONE_CONTAINER_NAME = "git-clone";
export const GIT_CREDS_SECRET_NAME = "git-creds";
export const GIT_CREDS_SECRET_KEY = "token";
export const GIT_CREDS_VOLUME_NAME = "git-creds";
export const GIT_CREDS_MOUNT_PATH = "/etc/git-creds";
export const GIT_FINALIZER_IMAGE = "localhost:5001/openvoid/git-finalizer:dev";
export const GIT_FINALIZER_CONTAINER_NAME = "git-finalizer";
export const DEFAULT_BRANCH = "main";

// OpenCode agent main container (Phase 6.2). The `OPENVOID_STUB_IMAGE`
// env var on the Session API process overrides the default to keep the
// Phase 5 nginx-driven lifecycle demo reproducible — see
// `routes/sessions.ts` for the override read.
export const OPENCODE_IMAGE = "localhost:5001/openvoid/opencode:dev";
// Port name `agent-http` is referenced by Phase 9 routing templates.
export const OPENCODE_AGENT_PORT = 8080;
export const OPENCODE_AGENT_PORT_NAME = "agent-http";

// `opencode-server-password` Secret — applied out-of-band, mirroring
// Phase 4's `git-creds`. The HTTP Basic password the OpenCode server
// requires to start (per Phase 0.3 spike). Phase 7's chart graduates
// this to an auto-generated chart-managed Secret.
export const OPENCODE_PASSWORD_SECRET_NAME = "opencode-server-password";
export const OPENCODE_PASSWORD_SECRET_KEY = "password";

// `opencode-auth` Secret — applied out-of-band, holds OpenCode's
// `auth.json` content (LLM provider credentials). Mounted only on the
// agent main container; never on `git-clone` or `git-finalizer`. The
// mount path is fixed by the image's `ENV XDG_DATA_HOME` (Unit 6.1) so
// the Secret target is independent of the runtime UID's $HOME — see
// docs/spikes/2026-05-05-opencode-auth.md for the full rationale.
export const OPENCODE_AUTH_SECRET_NAME = "opencode-auth";
export const OPENCODE_AUTH_SECRET_KEY = "auth.json";
export const OPENCODE_AUTH_VOLUME_NAME = "opencode-auth";
export const OPENCODE_AUTH_MOUNT_PATH =
  "/var/opencode-data/opencode/auth.json";

export type SessionPodSpec = {
  sessionId: string;
  image: string;
  repo: string;
  branch?: string;
  createdAt?: string;
};

export interface PodOps {
  createSessionPod(spec: SessionPodSpec): Promise<V1Pod>;
  getSessionPod(sessionId: string): Promise<V1Pod | null>;
  deleteSessionPod(sessionId: string): Promise<boolean>;
}

export function buildSessionPodManifest(spec: SessionPodSpec): V1Pod {
  const branch = spec.branch ?? DEFAULT_BRANCH;
  const createdAt = spec.createdAt ?? new Date().toISOString();
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: `session-${spec.sessionId.toLowerCase()}`,
      namespace: SESSION_NAMESPACE,
      labels: {
        [SESSION_LABEL]: spec.sessionId,
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      },
      annotations: {
        [REPO_ANNOTATION]: spec.repo,
        [BRANCH_ANNOTATION]: branch,
        [CREATED_AT_ANNOTATION]: createdAt,
      },
    },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: ACTIVE_DEADLINE_SECONDS,
      terminationGracePeriodSeconds: TERMINATION_GRACE_PERIOD_SECONDS,
      // Defense in depth alongside Phase 8's NetworkPolicy — the agent
      // pod must not be able to reach the K8s API. The pod has no
      // legitimate reason to enumerate Secrets or query other resources;
      // refusing the SA token closes the easiest path for a compromised
      // agent to escalate.
      automountServiceAccountToken: false,
      securityContext: {
        fsGroup: WORKSPACE_FS_GROUP,
      },
      volumes: [
        {
          name: WORKSPACE_VOLUME_NAME,
          emptyDir: {},
        },
        {
          name: GIT_CREDS_VOLUME_NAME,
          secret: { secretName: GIT_CREDS_SECRET_NAME },
        },
        {
          name: OPENCODE_AUTH_VOLUME_NAME,
          secret: {
            secretName: OPENCODE_AUTH_SECRET_NAME,
            // Project only the auth.json key; defaultMode 0o400 (octal
            // 256) so the file is readable by the runtime UID only.
            items: [
              {
                key: OPENCODE_AUTH_SECRET_KEY,
                path: OPENCODE_AUTH_SECRET_KEY,
              },
            ],
            defaultMode: 0o400,
          },
        },
      ],
      initContainers: [
        {
          name: GIT_CLONE_CONTAINER_NAME,
          image: GIT_CLONE_IMAGE,
          env: [
            { name: "REPO_URL", value: spec.repo },
            { name: "BRANCH", value: branch },
            {
              name: "GIT_TOKEN",
              valueFrom: {
                secretKeyRef: {
                  name: GIT_CREDS_SECRET_NAME,
                  key: GIT_CREDS_SECRET_KEY,
                },
              },
            },
          ],
          volumeMounts: [
            {
              name: WORKSPACE_VOLUME_NAME,
              mountPath: "/workspace",
            },
          ],
        },
        // Native sidecar (Kubernetes 1.28+): an initContainer with
        // restartPolicy=Always runs alongside the main container for the
        // life of the Pod. On Pod termination, the kubelet SIGTERMs main
        // first, waits for it to exit, then SIGTERMs this sidecar — giving
        // the entrypoint trap a clean window to push pending edits.
        {
          name: GIT_FINALIZER_CONTAINER_NAME,
          image: GIT_FINALIZER_IMAGE,
          restartPolicy: "Always",
          env: [
            {
              name: "GIT_TOKEN",
              valueFrom: {
                secretKeyRef: {
                  name: GIT_CREDS_SECRET_NAME,
                  key: GIT_CREDS_SECRET_KEY,
                },
              },
            },
          ],
          volumeMounts: [
            { name: WORKSPACE_VOLUME_NAME, mountPath: "/workspace" },
            {
              name: GIT_CREDS_VOLUME_NAME,
              mountPath: GIT_CREDS_MOUNT_PATH,
              readOnly: true,
            },
          ],
        },
      ],
      containers: [
        {
          name: "session",
          image: spec.image,
          ports: [
            {
              name: OPENCODE_AGENT_PORT_NAME,
              containerPort: OPENCODE_AGENT_PORT,
            },
          ],
          env: [
            {
              name: "OPENCODE_SERVER_PASSWORD",
              valueFrom: {
                secretKeyRef: {
                  name: OPENCODE_PASSWORD_SECRET_NAME,
                  key: OPENCODE_PASSWORD_SECRET_KEY,
                },
              },
            },
          ],
          volumeMounts: [
            {
              name: WORKSPACE_VOLUME_NAME,
              mountPath: WORKSPACE_MOUNT_PATH,
            },
            {
              // The opencode-auth Secret is mounted **only** here, not
              // on git-clone or git-finalizer. Symmetrically, git-creds
              // is mounted only on the init+sidecar pair, not here.
              // Each container sees only the credentials its job
              // requires; the unit tests assert this discipline as a
              // regression guard.
              name: OPENCODE_AUTH_VOLUME_NAME,
              mountPath: OPENCODE_AUTH_MOUNT_PATH,
              subPath: OPENCODE_AUTH_SECRET_KEY,
              readOnly: true,
            },
          ],
        },
      ],
    },
  };
}

export class K8sPodOps implements PodOps {
  constructor(private readonly api: CoreV1Api) {}

  async createSessionPod(spec: SessionPodSpec): Promise<V1Pod> {
    const body = buildSessionPodManifest(spec);
    return this.api.createNamespacedPod({ namespace: SESSION_NAMESPACE, body });
  }

  async getSessionPod(sessionId: string): Promise<V1Pod | null> {
    const list = await this.api.listNamespacedPod({
      namespace: SESSION_NAMESPACE,
      labelSelector: `${SESSION_LABEL}=${sessionId}`,
    });
    return list.items[0] ?? null;
  }

  async deleteSessionPod(sessionId: string): Promise<boolean> {
    const pod = await this.getSessionPod(sessionId);
    if (!pod?.metadata?.name) return false;
    await this.api.deleteNamespacedPod({
      name: pod.metadata.name,
      namespace: SESSION_NAMESPACE,
    });
    return true;
  }
}

export function loadKubeConfig(): KubeConfig {
  const kc = new KubeConfig();
  if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }
  return kc;
}

export function makePodOps(): PodOps {
  const kc = loadKubeConfig();
  return new K8sPodOps(kc.makeApiClient(CoreV1Api));
}
