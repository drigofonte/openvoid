import { CoreV1Api, KubeConfig, type V1Pod } from "@kubernetes/client-node";

export const SESSION_NAMESPACE = "openvoid-sessions";
export const SESSION_LABEL = "openvoid.io/session-id";
export const MANAGED_BY_LABEL = "openvoid.io/managed-by";
export const MANAGED_BY_VALUE = "session-api";

export const REPO_ANNOTATION = "openvoid.io/repo";
export const BRANCH_ANNOTATION = "openvoid.io/branch";
export const CREATED_AT_ANNOTATION = "openvoid.io/created-at";

export const ACTIVE_DEADLINE_SECONDS = 14400;

export const WORKSPACE_VOLUME_NAME = "workspace";
export const WORKSPACE_MOUNT_PATH = "/usr/share/nginx/html";
export const WORKSPACE_FS_GROUP = 65533;

export const GIT_CLONE_IMAGE = "alpine/git:2.45.2";
export const GIT_CLONE_CONTAINER_NAME = "git-clone";
export const GIT_CREDS_SECRET_NAME = "git-creds";
export const GIT_CREDS_SECRET_KEY = "token";
export const DEFAULT_BRANCH = "main";

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

const GIT_CLONE_SCRIPT = [
  "set -eu",
  "host_and_path=$(printf '%s' \"$REPO_URL\" | sed -E 's#^https?://##')",
  'auth_url="https://x-access-token:${GIT_TOKEN}@${host_and_path}"',
  'git clone --branch "$BRANCH" "$auth_url" /workspace/repo',
  'git -C /workspace/repo remote set-url origin "$REPO_URL"',
  'git -C /workspace/repo config user.email "agent@openvoid.local"',
  'git -C /workspace/repo config user.name "openvoid agent"',
].join("\n");

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
      securityContext: {
        fsGroup: WORKSPACE_FS_GROUP,
      },
      volumes: [
        {
          name: WORKSPACE_VOLUME_NAME,
          emptyDir: {},
        },
      ],
      initContainers: [
        {
          name: GIT_CLONE_CONTAINER_NAME,
          image: GIT_CLONE_IMAGE,
          command: ["/bin/sh", "-c", GIT_CLONE_SCRIPT],
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
      ],
      containers: [
        {
          name: "session",
          image: spec.image,
          ports: [{ containerPort: 80 }],
          volumeMounts: [
            {
              name: WORKSPACE_VOLUME_NAME,
              mountPath: WORKSPACE_MOUNT_PATH,
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
