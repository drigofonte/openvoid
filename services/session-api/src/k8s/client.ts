import { CoreV1Api, KubeConfig, type V1Pod } from "@kubernetes/client-node";

export const SESSION_NAMESPACE = "openvoid-sessions";
export const SESSION_LABEL = "openvoid.io/session-id";
export const MANAGED_BY_LABEL = "openvoid.io/managed-by";
export const MANAGED_BY_VALUE = "session-api";

export type SessionPodSpec = {
  sessionId: string;
  image: string;
};

export interface PodOps {
  createSessionPod(spec: SessionPodSpec): Promise<V1Pod>;
  getSessionPod(sessionId: string): Promise<V1Pod | null>;
  deleteSessionPod(sessionId: string): Promise<boolean>;
}

export function buildSessionPodManifest(spec: SessionPodSpec): V1Pod {
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
    },
    spec: {
      restartPolicy: "Never",
      containers: [
        {
          name: "session",
          image: spec.image,
          ports: [{ containerPort: 80 }],
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
