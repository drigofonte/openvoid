import {
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  type V1EnvVar,
  type V1Ingress,
  type V1OwnerReference,
  type V1Pod,
  type V1Service,
} from "@kubernetes/client-node";

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

// Per-session resource budget. Sized for a single OpenCode agent + the
// user's dev server in the same container.
//
// Picked after the kind control-plane OOM during a Phase 7 demo:
// without limits, multiple long-running sessions drift up until Docker
// Desktop's memory cap kicks in and the API server briefly disappears.
// Matched memory request and limit gives the pod Guaranteed QoS so the
// kubelet protects it last when the node is pressured. Graduates to
// chart values (`session.resources.*`) in Phase 9.
export const SESSION_CPU_REQUEST = "100m";
export const SESSION_CPU_LIMIT = "1000m";
export const SESSION_MEMORY_REQUEST = "1Gi";
export const SESSION_MEMORY_LIMIT = "1Gi";

// Init container (clone) and sidecar (finalizer) are short-lived or
// near-idle most of the time; small budgets are plenty.
export const SESSION_INIT_CPU_REQUEST = "50m";
export const SESSION_INIT_CPU_LIMIT = "200m";
export const SESSION_INIT_MEMORY_REQUEST = "64Mi";
export const SESSION_INIT_MEMORY_LIMIT = "128Mi";

// Workspace emptyDir cap. A user might pull a chunky repo or have the
// agent build a sizeable artifact tree; 10Gi keeps the per-session
// disk footprint bounded. K8s evicts the pod if the volume grows past
// the limit (a clean failure mode rather than node-disk exhaustion).
export const WORKSPACE_VOLUME_NAME = "workspace";
export const WORKSPACE_SIZE_LIMIT = "10Gi";
// Mount path on the agent main container. Matches OpenCode's WORKDIR
// (/workspace/repo) so the agent's cwd is the cloned repo. The
// initContainer (workspace-init) and sidecar (git-finalizer) mount the
// same volume at /workspace and see the repo at /workspace/repo.
export const WORKSPACE_MOUNT_PATH = "/workspace";
export const WORKSPACE_FS_GROUP = 65533;

export const WORKSPACE_INIT_IMAGE = "localhost:5001/openvoid/workspace-init:dev";
export const WORKSPACE_INIT_CONTAINER_NAME = "workspace-init";
export const GIT_CREDS_SECRET_NAME = "git-creds";
export const GIT_CREDS_SECRET_KEY = "token";
export const GIT_CREDS_VOLUME_NAME = "git-creds";
export const GIT_CREDS_MOUNT_PATH = "/etc/git-creds";

// Platform-org GitHub PAT — distinct from `git-creds`. For new-app
// pods both the workspace-init initContainer (seed push) and the
// git-finalizer sidecar (on-exit push) mount this Secret instead of
// `git-creds`, because the new repo lives under the platform org and
// a user-side PAT would 403 against it.
export const GITHUB_PLATFORM_CREDS_SECRET_NAME = "github-platform-creds";
export const GITHUB_PLATFORM_CREDS_SECRET_KEY = "token";

export const GIT_FINALIZER_IMAGE = "localhost:5001/openvoid/git-finalizer:dev";
export const GIT_FINALIZER_CONTAINER_NAME = "git-finalizer";
export const DEFAULT_BRANCH = "main";

// Default scaffold-template URL for the new-app entry point.
// Overridable per session via SessionPodSpec.scaffoldTemplate; for
// realistic operator setups, OPENVOID_SCAFFOLD_TEMPLATE_URL on the
// Session API Deployment is the seam.
export const DEFAULT_SCAFFOLD_TEMPLATE_URL =
  "https://github.com/drigolabs/openvoid-scaffold-react.git";

export function getScaffoldTemplateUrl(): string {
  return envOr("OPENVOID_SCAFFOLD_TEMPLATE_URL", DEFAULT_SCAFFOLD_TEMPLATE_URL);
}

// OpenCode agent main container (Phase 6.2). The `OPENVOID_STUB_IMAGE`
// env var on the Session API process overrides the default to keep the
// Phase 5 nginx-driven lifecycle demo reproducible — see
// `routes/sessions.ts` for the override read.
export const OPENCODE_IMAGE = "localhost:5001/openvoid/opencode:dev";
// Port name `agent-http` is referenced by Phase 9 routing templates.
export const OPENCODE_AGENT_PORT = 8080;
export const OPENCODE_AGENT_PORT_NAME = "agent-http";

// The user's preview port — convention is 3000 (Next.js, Vite) but the
// agent can run anything on it. Phase 7 wires the per-session preview
// Ingress to expose this. The container port is informational; the
// Service/Ingress chain is what makes traffic flow.
export const OPENCODE_PREVIEW_PORT = 3000;
export const OPENCODE_PREVIEW_PORT_NAME = "preview-http";

// `opencode-server-password` Secret — applied out-of-band, mirroring
// Phase 4's `git-creds`. The HTTP Basic password the OpenCode server
// requires to start (per Phase 0.3 spike). Phase 9's chart graduates
// this to an auto-generated chart-managed Secret.
export const OPENCODE_PASSWORD_SECRET_NAME = "opencode-server-password";
export const OPENCODE_PASSWORD_SECRET_KEY = "password";

// `opencode-auth` Secret — applied out-of-band, holds OpenCode's
// `auth.json` content (LLM provider credentials). Mounted only on the
// agent main container; never on `workspace-init` or `git-finalizer`. The
// mount path is fixed by the image's `ENV XDG_DATA_HOME` (Unit 6.1) so
// the Secret target is independent of the runtime UID's $HOME — see
// docs/spikes/2026-05-05-opencode-auth.md for the full rationale.
export const OPENCODE_AUTH_SECRET_NAME = "opencode-auth";
export const OPENCODE_AUTH_SECRET_KEY = "auth.json";
export const OPENCODE_AUTH_VOLUME_NAME = "opencode-auth";
export const OPENCODE_AUTH_MOUNT_PATH =
  "/var/opencode-data/opencode/auth.json";

// Phase 7 routing config. `OPENVOID_DOMAIN_BASE` and `OPENVOID_URL_SCHEME`
// drive the per-session host names and surfaced URLs. Defaults match the
// kind setup (nip.io + http); DOKS overrides via env in Phase 8 then via
// chart values in Phase 9.
export const INGRESS_CLASS_NAME = "nginx";
export const DEFAULT_DOMAIN_BASE = "127.0.0.1.nip.io";
export const DEFAULT_URL_SCHEME = "http";

// `OPENCODE_BASIC_USER` is fixed by OpenCode's HTTP Basic auth
// implementation: the username is "opencode", the password comes from
// OPENCODE_SERVER_PASSWORD. The agent UI loads inside an iframe via the
// per-session ingress, which injects this header at the edge so the
// browser never sees a password prompt.
export const OPENCODE_BASIC_USER = "opencode";

export type SessionPodSpec = {
  sessionId: string;
  image: string;
  repo: string;
  branch?: string;
  createdAt?: string;
  // New-app extensions (U6). When `isNewApp` is true the workspace-init
  // script reads `OPENVOID_NEW_APP`, `SCAFFOLD_TEMPLATE_URL`, and
  // `SCAFFOLD_PROMPT` from env and takes the scaffold-seed branch
  // instead of the existing clone-repo branch. The Secret backing
  // `GIT_TOKEN` swaps from `git-creds` to `github-platform-creds` on
  // both workspace-init and git-finalizer — see
  // GITHUB_PLATFORM_CREDS_SECRET_NAME and the manifest builder.
  isNewApp?: boolean;
  scaffoldTemplate?: string;
  prompt?: string;
};

// Lightweight reference back to the parent Pod, used to build
// ownerReferences on Service + Ingress so K8s garbage-collects them when
// the Pod disappears (cascade delete).
export type PodOwner = { name: string; uid: string };

export type BuildResourcesOpts = {
  // Pre-formatted `Basic <base64(opencode:password)>`. Loaded once at
  // Session API boot via `loadOpencodeAuthHeader` and reused for every
  // session — the password is cluster-wide, not per-session.
  authHeaderValue: string;
  domainBase?: string;
  urlScheme?: string;
  // Optional — when present, Service + Ingresses get ownerReferences on
  // the Pod (cascade delete via GC). At the unit-test boundary it can be
  // omitted; in production it's filled in after `createNamespacedPod`
  // returns the live Pod with its UID.
  podOwner?: PodOwner;
};

export type SessionResources = {
  pod: V1Pod;
  service: V1Service;
  agentIngress: V1Ingress;
  previewIngress: V1Ingress;
};

export interface SessionOps {
  createSessionResources(spec: SessionPodSpec): Promise<SessionResources>;
  getSessionPod(sessionId: string): Promise<V1Pod | null>;
  deleteSessionResources(sessionId: string): Promise<boolean>;
}

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export function getDomainBase(): string {
  return envOr("OPENVOID_DOMAIN_BASE", DEFAULT_DOMAIN_BASE);
}

export function getUrlScheme(): string {
  return envOr("OPENVOID_URL_SCHEME", DEFAULT_URL_SCHEME);
}

// Session IDs are ULIDs (uppercase); host labels and resource names must
// be lowercase per K8s/DNS rules. Centralize the conversion so every URL
// surfaced by the API (and every Ingress host) is consistent.
function sidLower(sessionId: string): string {
  return sessionId.toLowerCase();
}

export function agentHost(sessionId: string, domainBase = getDomainBase()): string {
  return `${sidLower(sessionId)}.agent.${domainBase}`;
}

export function previewHost(sessionId: string, domainBase = getDomainBase()): string {
  return `${sidLower(sessionId)}.preview.${domainBase}`;
}

export function agentUrl(
  sessionId: string,
  domainBase = getDomainBase(),
  urlScheme = getUrlScheme(),
): string {
  return `${urlScheme}://${agentHost(sessionId, domainBase)}/`;
}

export function previewUrl(
  sessionId: string,
  domainBase = getDomainBase(),
  urlScheme = getUrlScheme(),
): string {
  return `${urlScheme}://${previewHost(sessionId, domainBase)}/`;
}

function podName(sessionId: string): string {
  return `session-${sidLower(sessionId)}`;
}

function commonLabels(sessionId: string): Record<string, string> {
  return {
    [SESSION_LABEL]: sessionId,
    [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  };
}

function ownerReferenceFor(owner: PodOwner | undefined): V1OwnerReference[] | undefined {
  if (!owner) return undefined;
  return [
    {
      apiVersion: "v1",
      kind: "Pod",
      name: owner.name,
      uid: owner.uid,
      // controller=false: nothing in our model "controls" the Pod from
      // the Service/Ingress side. blockOwnerDeletion=false: K8s GC will
      // not stall Pod deletion waiting for these to clear.
      controller: false,
      blockOwnerDeletion: false,
    },
  ];
}

export function buildSessionPodManifest(spec: SessionPodSpec): V1Pod {
  const branch = spec.branch ?? DEFAULT_BRANCH;
  const createdAt = spec.createdAt ?? new Date().toISOString();
  const isNewApp = spec.isNewApp === true;
  // The Secret backing GIT_TOKEN differs per mode. import-repo pods
  // use git-creds (user-side, scoped to the imported repo);
  // new-app pods use github-platform-creds (platform PAT, can write
  // to repos under the platform org). The volume name stays
  // `git-creds` for both modes to keep the mount-discipline
  // invariants and existing tests simple — the volume name is an
  // internal handle, not a Secret identifier.
  const gitTokenSecretName = isNewApp
    ? GITHUB_PLATFORM_CREDS_SECRET_NAME
    : GIT_CREDS_SECRET_NAME;
  const gitTokenSecretKey = isNewApp
    ? GITHUB_PLATFORM_CREDS_SECRET_KEY
    : GIT_CREDS_SECRET_KEY;

  const workspaceInitEnv: V1EnvVar[] = [
    { name: "REPO_URL", value: spec.repo },
    { name: "BRANCH", value: branch },
    {
      name: "GIT_TOKEN",
      valueFrom: {
        secretKeyRef: { name: gitTokenSecretName, key: gitTokenSecretKey },
      },
    },
  ];
  if (isNewApp) {
    workspaceInitEnv.push(
      { name: "OPENVOID_NEW_APP", value: "true" },
      {
        name: "SCAFFOLD_TEMPLATE_URL",
        value: spec.scaffoldTemplate ?? getScaffoldTemplateUrl(),
      },
      { name: "SCAFFOLD_PROMPT", value: spec.prompt ?? "" },
    );
  }

  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: podName(spec.sessionId),
      namespace: SESSION_NAMESPACE,
      labels: commonLabels(spec.sessionId),
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
      // Defense in depth alongside Phase 9's NetworkPolicy — the agent
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
          emptyDir: { sizeLimit: WORKSPACE_SIZE_LIMIT },
        },
        {
          name: GIT_CREDS_VOLUME_NAME,
          secret: { secretName: gitTokenSecretName },
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
          name: WORKSPACE_INIT_CONTAINER_NAME,
          image: WORKSPACE_INIT_IMAGE,
          resources: {
            requests: {
              cpu: SESSION_INIT_CPU_REQUEST,
              memory: SESSION_INIT_MEMORY_REQUEST,
            },
            limits: {
              cpu: SESSION_INIT_CPU_LIMIT,
              memory: SESSION_INIT_MEMORY_LIMIT,
            },
          },
          env: workspaceInitEnv,
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
          resources: {
            requests: {
              cpu: SESSION_INIT_CPU_REQUEST,
              memory: SESSION_INIT_MEMORY_REQUEST,
            },
            limits: {
              cpu: SESSION_INIT_CPU_LIMIT,
              memory: SESSION_INIT_MEMORY_LIMIT,
            },
          },
          env: [
            {
              name: "GIT_TOKEN",
              valueFrom: {
                secretKeyRef: {
                  name: gitTokenSecretName,
                  key: gitTokenSecretKey,
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
          resources: {
            requests: {
              cpu: SESSION_CPU_REQUEST,
              memory: SESSION_MEMORY_REQUEST,
            },
            limits: {
              cpu: SESSION_CPU_LIMIT,
              memory: SESSION_MEMORY_LIMIT,
            },
          },
          ports: [
            {
              name: OPENCODE_AGENT_PORT_NAME,
              containerPort: OPENCODE_AGENT_PORT,
            },
            // Preview port. Declaring the port is informational, but it
            // documents the contract the per-session Service routes to.
            {
              name: OPENCODE_PREVIEW_PORT_NAME,
              containerPort: OPENCODE_PREVIEW_PORT,
            },
          ],
          env: buildAgentEnv(isNewApp),
          volumeMounts: [
            {
              name: WORKSPACE_VOLUME_NAME,
              mountPath: WORKSPACE_MOUNT_PATH,
            },
            {
              // The opencode-auth Secret is mounted **only** here, not
              // on workspace-init or git-finalizer. Symmetrically,
              // git-creds is mounted only on the init+sidecar pair, not
              // here.
              // Each container sees only the credentials its job
              // requires; the unit tests assert this discipline as a
              // regression guard.
              name: OPENCODE_AUTH_VOLUME_NAME,
              mountPath: OPENCODE_AUTH_MOUNT_PATH,
              subPath: OPENCODE_AUTH_SECRET_KEY,
              readOnly: true,
            },
          ],
          // readinessProbe is conditional on new-app: only new-app pods
          // run `pnpm dev` on port 3000, and only they should gate
          // Ready on its response. Import-repo pods keep today's
          // "Ready as soon as the container is up" behaviour — they
          // have no pre-started dev server to probe.
          ...(isNewApp
            ? {
                readinessProbe: {
                  httpGet: {
                    port: OPENCODE_PREVIEW_PORT,
                    path: "/",
                  },
                  // 5s initial delay covers OpenCode + pnpm dev cold
                  // start; 3s × 30 = 90s ceiling before the pod is
                  // marked NotReady, which is enough for first-time
                  // Vite boot on a cold node.
                  initialDelaySeconds: 5,
                  periodSeconds: 3,
                  timeoutSeconds: 2,
                  failureThreshold: 30,
                },
              }
            : {}),
        },
      ],
    },
  };
}

function buildAgentEnv(isNewApp: boolean): V1EnvVar[] {
  const env: V1EnvVar[] = [
    {
      name: "OPENCODE_SERVER_PASSWORD",
      valueFrom: {
        secretKeyRef: {
          name: OPENCODE_PASSWORD_SECRET_NAME,
          key: OPENCODE_PASSWORD_SECRET_KEY,
        },
      },
    },
  ];
  if (isNewApp) {
    // Selects the dual-process branch in entrypoint.sh (pnpm dev +
    // opencode serve). Import-repo pods omit this and get the
    // single-process opencode-only behaviour.
    env.push({ name: "OPENVOID_NEW_APP", value: "true" });
  }
  return env;
}

export function buildSessionService(
  spec: SessionPodSpec,
  podOwner?: PodOwner,
): V1Service {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: podName(spec.sessionId),
      namespace: SESSION_NAMESPACE,
      labels: commonLabels(spec.sessionId),
      ownerReferences: ownerReferenceFor(podOwner),
    },
    spec: {
      type: "ClusterIP",
      // Match the Pod's session-id label rather than name — both
      // identify the same Pod (one per session) but the label is the
      // stable identifier the rest of the system already uses.
      selector: { [SESSION_LABEL]: spec.sessionId },
      ports: [
        {
          name: OPENCODE_AGENT_PORT_NAME,
          port: OPENCODE_AGENT_PORT,
          targetPort: OPENCODE_AGENT_PORT_NAME,
          protocol: "TCP",
        },
        {
          name: OPENCODE_PREVIEW_PORT_NAME,
          port: OPENCODE_PREVIEW_PORT,
          targetPort: OPENCODE_PREVIEW_PORT_NAME,
          protocol: "TCP",
        },
      ],
    },
  };
}

type IngressKind = "agent" | "preview";

function buildSessionIngress(
  spec: SessionPodSpec,
  kind: IngressKind,
  opts: BuildResourcesOpts,
): V1Ingress {
  const domainBase = opts.domainBase ?? getDomainBase();
  const isAgent = kind === "agent";
  const host = isAgent
    ? agentHost(spec.sessionId, domainBase)
    : previewHost(spec.sessionId, domainBase);
  const portName = isAgent ? OPENCODE_AGENT_PORT_NAME : OPENCODE_PREVIEW_PORT_NAME;

  // The configuration-snippet annotation is per-Ingress in
  // ingress-nginx, not per-rule. To keep the agent host authenticated
  // and the preview host untouched, the two hosts live on separate
  // Ingress resources — the agent one carries the snippet, the preview
  // one has no auth-related annotations.
  //
  // The injected header value is fixed at boot from the
  // `opencode-server-password` Secret (see loadOpencodeAuthHeader).
  // Quote-safety: the password is a 32-char alphanumeric string from
  // openssl/randAlphaNum (Phase 6 / Phase 9), so it never contains `"`
  // or `\` — embedding it in the nginx string literal is safe.
  const annotations: Record<string, string> = {};
  if (isAgent) {
    annotations["nginx.ingress.kubernetes.io/configuration-snippet"] =
      `proxy_set_header Authorization "${opts.authHeaderValue}";\n`;
  }

  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name: `${podName(spec.sessionId)}-${kind}`,
      namespace: SESSION_NAMESPACE,
      labels: commonLabels(spec.sessionId),
      annotations,
      ownerReferences: ownerReferenceFor(opts.podOwner),
    },
    spec: {
      ingressClassName: INGRESS_CLASS_NAME,
      rules: [
        {
          host,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: podName(spec.sessionId),
                    port: { name: portName },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export function buildSessionAgentIngress(
  spec: SessionPodSpec,
  opts: BuildResourcesOpts,
): V1Ingress {
  return buildSessionIngress(spec, "agent", opts);
}

export function buildSessionPreviewIngress(
  spec: SessionPodSpec,
  opts: BuildResourcesOpts,
): V1Ingress {
  return buildSessionIngress(spec, "preview", opts);
}

export function buildSessionResources(
  spec: SessionPodSpec,
  opts: BuildResourcesOpts,
): SessionResources {
  return {
    pod: buildSessionPodManifest(spec),
    service: buildSessionService(spec, opts.podOwner),
    agentIngress: buildSessionAgentIngress(spec, opts),
    previewIngress: buildSessionPreviewIngress(spec, opts),
  };
}

// Loaded once at boot (server.ts) and cached on the SessionOps. Rotation
// path is documented as "restart the Session API" — Phase 9's chart can
// add a Watcher when v1.5 needs zero-downtime rotation.
export async function loadOpencodeAuthHeader(api: CoreV1Api): Promise<string> {
  let secret;
  try {
    secret = await api.readNamespacedSecret({
      name: OPENCODE_PASSWORD_SECRET_NAME,
      namespace: SESSION_NAMESPACE,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot read Secret ${SESSION_NAMESPACE}/${OPENCODE_PASSWORD_SECRET_NAME} ` +
        `(required for edge auth-injection on per-session ingress): ${reason}`,
    );
  }

  const passwordB64 = secret.data?.[OPENCODE_PASSWORD_SECRET_KEY];
  if (passwordB64 === undefined) {
    throw new Error(
      `Secret ${SESSION_NAMESPACE}/${OPENCODE_PASSWORD_SECRET_NAME} ` +
        `is missing key "${OPENCODE_PASSWORD_SECRET_KEY}".`,
    );
  }
  const password = Buffer.from(passwordB64, "base64").toString("utf8");
  if (password.length === 0) {
    throw new Error(
      `Secret ${SESSION_NAMESPACE}/${OPENCODE_PASSWORD_SECRET_NAME}.${OPENCODE_PASSWORD_SECRET_KEY} ` +
        `decoded to an empty string.`,
    );
  }
  return `Basic ${Buffer.from(`${OPENCODE_BASIC_USER}:${password}`).toString("base64")}`;
}

export class K8sSessionOps implements SessionOps {
  constructor(
    private readonly core: CoreV1Api,
    private readonly networking: NetworkingV1Api,
    private readonly authHeaderValue: string,
  ) {}

  async createSessionResources(spec: SessionPodSpec): Promise<SessionResources> {
    // Step 1: Pod first — its UID becomes the ownerRef target for the
    // Service + Ingresses. Cascade-delete via GC handles cleanup when
    // the Pod disappears.
    const pod = await this.core.createNamespacedPod({
      namespace: SESSION_NAMESPACE,
      body: buildSessionPodManifest(spec),
    });

    const owner: PodOwner | undefined =
      pod.metadata?.name && pod.metadata?.uid
        ? { name: pod.metadata.name, uid: pod.metadata.uid }
        : undefined;

    const opts: BuildResourcesOpts = {
      authHeaderValue: this.authHeaderValue,
      podOwner: owner,
    };

    // Steps 2–4 are wrapped in a rollback try/catch. Without this, a
    // failure on Service or either Ingress creation leaves the Pod we
    // just created consuming resources for `activeDeadlineSeconds`
    // (4h) before the kubelet failsafe reaps it. The Service / agent
    // Ingress / preview Ingress all carry ownerReferences pointing at
    // the Pod, so deleting the Pod cascades to whichever ones already
    // got created — best-effort, swallow non-fatal cleanup errors.
    try {
      // Step 2: Service.
      const service = await this.core.createNamespacedService({
        namespace: SESSION_NAMESPACE,
        body: buildSessionService(spec, owner),
      });

      // Step 3: two Ingresses — agent (with auth-injection snippet),
      // preview (no auth). Order doesn't matter functionally; sequential
      // for clear error attribution.
      const agentIngress = await this.networking.createNamespacedIngress({
        namespace: SESSION_NAMESPACE,
        body: buildSessionAgentIngress(spec, opts),
      });
      const previewIngress = await this.networking.createNamespacedIngress({
        namespace: SESSION_NAMESPACE,
        body: buildSessionPreviewIngress(spec, opts),
      });

      return { pod, service, agentIngress, previewIngress };
    } catch (err) {
      if (pod.metadata?.name) {
        try {
          await this.core.deleteNamespacedPod({
            name: pod.metadata.name,
            namespace: SESSION_NAMESPACE,
          });
        } catch {
          // Best-effort. The original create error is what we surface
          // to the caller; failing the rollback shouldn't shadow it.
        }
      }
      throw err;
    }
  }

  async getSessionPod(sessionId: string): Promise<V1Pod | null> {
    const list = await this.core.listNamespacedPod({
      namespace: SESSION_NAMESPACE,
      labelSelector: `${SESSION_LABEL}=${sessionId}`,
    });
    return list.items[0] ?? null;
  }

  async deleteSessionResources(sessionId: string): Promise<boolean> {
    const pod = await this.getSessionPod(sessionId);
    if (!pod?.metadata?.name) return false;
    const name = pod.metadata.name;

    // Belt-and-braces deletion: ownerReferences cause GC to remove the
    // Service + Ingresses when the Pod is gone, but GC isn't immediate.
    // Tearing them down explicitly keeps the demo flow's "everything's
    // gone right now" feel and shields against GC backlogs in CI.
    // 404s are expected — concurrent deletes / GC racing — so swallow
    // them per resource.
    const swallow404 = async (op: Promise<unknown>): Promise<void> => {
      try {
        await op;
      } catch (err) {
        if (!is404(err)) throw err;
      }
    };
    await swallow404(
      this.networking.deleteNamespacedIngress({ name: `${name}-agent`, namespace: SESSION_NAMESPACE }),
    );
    await swallow404(
      this.networking.deleteNamespacedIngress({ name: `${name}-preview`, namespace: SESSION_NAMESPACE }),
    );
    await swallow404(
      this.core.deleteNamespacedService({ name, namespace: SESSION_NAMESPACE }),
    );
    // Pod delete must also tolerate a concurrent GC / external delete that
    // already removed the Pod between getSessionPod and here; otherwise the
    // route surfaces 503 on what is, from the user's perspective, a
    // successful "make this gone" outcome.
    await swallow404(
      this.core.deleteNamespacedPod({ name, namespace: SESSION_NAMESPACE }),
    );
    return true;
  }
}

function is404(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e.code === 404 || e.statusCode === 404 || e.response?.statusCode === 404;
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

export async function makeSessionOps(): Promise<SessionOps> {
  const kc = loadKubeConfig();
  const core = kc.makeApiClient(CoreV1Api);
  const networking = kc.makeApiClient(NetworkingV1Api);
  const authHeaderValue = await loadOpencodeAuthHeader(core);
  return new K8sSessionOps(core, networking, authHeaderValue);
}
