// Phase 7.2 — focused unit tests for the per-session Service + Ingress
// builders. These complement the broader sessionsRouter tests in
// routes.sessions.test.ts; the goal here is to pin the routing/auth
// invariants explicitly so future refactors can't quietly:
//   - drop the auth-injection annotation from the agent host
//   - leak it onto the preview host
//   - lose ownerReferences (which would break cascade delete)
//   - flip env-driven hostnames to the wrong scheme/domain

import { describe, it, expect, afterEach, vi } from "vitest";
import type { CoreV1Api } from "@kubernetes/client-node";
import {
  type BuildResourcesOpts,
  type SessionPodSpec,
  buildSessionAgentIngress,
  buildSessionPreviewIngress,
  buildSessionResources,
  buildSessionService,
  loadOpencodeAuthHeader,
  agentHost,
  agentUrl,
  previewHost,
  previewUrl,
  getDomainBase,
  getUrlScheme,
  DEFAULT_DOMAIN_BASE,
  DEFAULT_URL_SCHEME,
  INGRESS_CLASS_NAME,
  OPENCODE_AGENT_PORT,
  OPENCODE_AGENT_PORT_NAME,
  OPENCODE_IMAGE,
  OPENCODE_PASSWORD_SECRET_KEY,
  OPENCODE_PREVIEW_PORT,
  OPENCODE_PREVIEW_PORT_NAME,
  SESSION_LABEL,
  SESSION_NAMESPACE,
} from "../../src/k8s/client.js";

const SPEC: SessionPodSpec = {
  sessionId: "01HABCDEFGHJKMNPQRSTVWXYZA",
  image: OPENCODE_IMAGE,
  repo: "https://github.com/example/x",
};

const AUTH_HEADER = "Basic b3BlbmNvZGU6c3VwZXItc2VjcmV0";

const SAMPLE_OWNER = { name: "session-01habcdefghjkmnpqrstvwxyza", uid: "uid-1234" };

const DEFAULT_OPTS: BuildResourcesOpts = {
  authHeaderValue: AUTH_HEADER,
  podOwner: SAMPLE_OWNER,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env-driven host/URL helpers", () => {
  it("defaults to nip.io + http when env vars are unset", () => {
    expect(getDomainBase()).toBe(DEFAULT_DOMAIN_BASE);
    expect(getUrlScheme()).toBe(DEFAULT_URL_SCHEME);
    expect(DEFAULT_DOMAIN_BASE).toBe("127.0.0.1.nip.io");
    expect(DEFAULT_URL_SCHEME).toBe("http");
  });

  it("lowercases the session ID in the host label", () => {
    expect(agentHost(SPEC.sessionId)).toBe(
      `${SPEC.sessionId.toLowerCase()}.agent.${DEFAULT_DOMAIN_BASE}`,
    );
    expect(previewHost(SPEC.sessionId)).toBe(
      `${SPEC.sessionId.toLowerCase()}.preview.${DEFAULT_DOMAIN_BASE}`,
    );
  });

  it("respects OPENVOID_DOMAIN_BASE + OPENVOID_URL_SCHEME", () => {
    vi.stubEnv("OPENVOID_DOMAIN_BASE", "foo.example.com");
    vi.stubEnv("OPENVOID_URL_SCHEME", "https");
    expect(agentHost(SPEC.sessionId)).toBe(
      `${SPEC.sessionId.toLowerCase()}.agent.foo.example.com`,
    );
    expect(previewHost(SPEC.sessionId)).toBe(
      `${SPEC.sessionId.toLowerCase()}.preview.foo.example.com`,
    );
    expect(agentUrl(SPEC.sessionId)).toMatch(/^https:\/\/.+\.agent\.foo\.example\.com\/$/);
    expect(previewUrl(SPEC.sessionId)).toMatch(/^https:\/\/.+\.preview\.foo\.example\.com\/$/);
  });
});

describe("buildSessionService", () => {
  it("declares two named ports, agent-http (8080) and preview-http (3000)", () => {
    const svc = buildSessionService(SPEC, SAMPLE_OWNER);
    const ports = svc.spec?.ports ?? [];
    expect(ports).toContainEqual(
      expect.objectContaining({
        name: OPENCODE_AGENT_PORT_NAME,
        port: OPENCODE_AGENT_PORT,
        targetPort: OPENCODE_AGENT_PORT_NAME,
      }),
    );
    expect(ports).toContainEqual(
      expect.objectContaining({
        name: OPENCODE_PREVIEW_PORT_NAME,
        port: OPENCODE_PREVIEW_PORT,
        targetPort: OPENCODE_PREVIEW_PORT_NAME,
      }),
    );
    expect(ports).toHaveLength(2);
  });

  it("selects pods by openvoid.io/session-id label, not by name", () => {
    const svc = buildSessionService(SPEC, SAMPLE_OWNER);
    expect(svc.spec?.selector).toEqual({ [SESSION_LABEL]: SPEC.sessionId });
  });

  it("lives in the openvoid-sessions namespace and has the standard labels", () => {
    const svc = buildSessionService(SPEC, SAMPLE_OWNER);
    expect(svc.metadata?.namespace).toBe(SESSION_NAMESPACE);
    expect(svc.metadata?.labels?.[SESSION_LABEL]).toBe(SPEC.sessionId);
  });

  it("sets ownerReferences pointing at the Pod (controller=false, blockOwnerDeletion=false)", () => {
    const svc = buildSessionService(SPEC, SAMPLE_OWNER);
    expect(svc.metadata?.ownerReferences).toEqual([
      {
        apiVersion: "v1",
        kind: "Pod",
        name: SAMPLE_OWNER.name,
        uid: SAMPLE_OWNER.uid,
        controller: false,
        blockOwnerDeletion: false,
      },
    ]);
  });

  it("omits ownerReferences when no podOwner is given (pre-creation builder use)", () => {
    const svc = buildSessionService(SPEC);
    expect(svc.metadata?.ownerReferences).toBeUndefined();
  });
});

describe("buildSessionAgentIngress", () => {
  it("uses ingressClassName=nginx and a single rule on the agent host", () => {
    const ing = buildSessionAgentIngress(SPEC, DEFAULT_OPTS);
    expect(ing.spec?.ingressClassName).toBe(INGRESS_CLASS_NAME);
    const rules = ing.spec?.rules ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.host).toBe(agentHost(SPEC.sessionId));
  });

  it("routes / to the Service's named agent-http port", () => {
    const ing = buildSessionAgentIngress(SPEC, DEFAULT_OPTS);
    const path = ing.spec?.rules?.[0]?.http?.paths?.[0];
    expect(path?.path).toBe("/");
    expect(path?.pathType).toBe("Prefix");
    expect(path?.backend?.service?.name).toBe("session-01habcdefghjkmnpqrstvwxyza");
    expect(path?.backend?.service?.port).toEqual({ name: OPENCODE_AGENT_PORT_NAME });
  });

  it("injects Authorization via the configuration-snippet annotation, with the supplied auth header", () => {
    const ing = buildSessionAgentIngress(SPEC, DEFAULT_OPTS);
    const snippet =
      ing.metadata?.annotations?.["nginx.ingress.kubernetes.io/configuration-snippet"];
    expect(snippet, "snippet annotation must be set").toBeDefined();
    expect(snippet).toContain('proxy_set_header Authorization');
    // The Basic token is what loadOpencodeAuthHeader returns at boot.
    // The header value lands verbatim inside the nginx string literal.
    expect(snippet).toContain(AUTH_HEADER);
  });

  it("sets ownerReferences pointing at the Pod", () => {
    const ing = buildSessionAgentIngress(SPEC, DEFAULT_OPTS);
    expect(ing.metadata?.ownerReferences?.[0]?.uid).toBe(SAMPLE_OWNER.uid);
  });

  it("respects OPENVOID_DOMAIN_BASE for host derivation", () => {
    vi.stubEnv("OPENVOID_DOMAIN_BASE", "foo.example.com");
    const ing = buildSessionAgentIngress(SPEC, { authHeaderValue: AUTH_HEADER });
    expect(ing.spec?.rules?.[0]?.host).toBe(
      `${SPEC.sessionId.toLowerCase()}.agent.foo.example.com`,
    );
  });
});

describe("buildSessionPreviewIngress", () => {
  it("uses ingressClassName=nginx and routes to the preview-http port on the preview host", () => {
    const ing = buildSessionPreviewIngress(SPEC, DEFAULT_OPTS);
    expect(ing.spec?.ingressClassName).toBe(INGRESS_CLASS_NAME);
    const rule = ing.spec?.rules?.[0];
    expect(rule?.host).toBe(previewHost(SPEC.sessionId));
    expect(rule?.http?.paths?.[0]?.backend?.service?.port).toEqual({
      name: OPENCODE_PREVIEW_PORT_NAME,
    });
  });

  it("does NOT carry a configuration-snippet annotation (preview is unauthenticated)", () => {
    const ing = buildSessionPreviewIngress(SPEC, DEFAULT_OPTS);
    expect(
      ing.metadata?.annotations?.["nginx.ingress.kubernetes.io/configuration-snippet"],
    ).toBeUndefined();
  });

  it("does not leak the Authorization header into any annotation on the preview Ingress", () => {
    const ing = buildSessionPreviewIngress(SPEC, DEFAULT_OPTS);
    const annotations = ing.metadata?.annotations ?? {};
    for (const [key, value] of Object.entries(annotations)) {
      expect(value, `annotation ${key} leaks the auth header`).not.toContain(AUTH_HEADER);
      expect(value, `annotation ${key} sets Authorization header`).not.toMatch(
        /Authorization/i,
      );
    }
  });

  it("uses a different resource name from the agent Ingress", () => {
    const agent = buildSessionAgentIngress(SPEC, DEFAULT_OPTS);
    const preview = buildSessionPreviewIngress(SPEC, DEFAULT_OPTS);
    expect(agent.metadata?.name).not.toBe(preview.metadata?.name);
  });
});

describe("loadOpencodeAuthHeader", () => {
  function fakeApi(secret: { data?: Record<string, string> } | Error): CoreV1Api {
    return {
      readNamespacedSecret: vi.fn(async () => {
        if (secret instanceof Error) throw secret;
        return secret;
      }),
    } as unknown as CoreV1Api;
  }

  it("base64-encodes opencode:<password> and prefixes Basic ", async () => {
    const password = "super-secret-pw";
    const data = { [OPENCODE_PASSWORD_SECRET_KEY]: Buffer.from(password).toString("base64") };
    const header = await loadOpencodeAuthHeader(fakeApi({ data }));
    expect(header).toBe(
      `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    );
  });

  it("fails fast with a clear message when the Secret read throws (e.g. RBAC, missing)", async () => {
    const apiErr = Object.assign(new Error("forbidden"), { code: 403 });
    await expect(loadOpencodeAuthHeader(fakeApi(apiErr))).rejects.toThrow(
      /Cannot read Secret openvoid-sessions\/opencode-server-password/,
    );
  });

  it("fails fast when the Secret is missing the password key", async () => {
    await expect(loadOpencodeAuthHeader(fakeApi({ data: {} }))).rejects.toThrow(
      /missing key "password"/,
    );
  });

  it("fails fast when the password value decodes to an empty string", async () => {
    await expect(
      loadOpencodeAuthHeader(fakeApi({ data: { [OPENCODE_PASSWORD_SECRET_KEY]: "" } })),
    ).rejects.toThrow(/empty string/);
  });
});

describe("buildSessionResources (integrated)", () => {
  it("returns a Pod, a Service, and two distinct Ingresses", () => {
    const r = buildSessionResources(SPEC, DEFAULT_OPTS);
    expect(r.pod.kind).toBe("Pod");
    expect(r.service.kind).toBe("Service");
    expect(r.agentIngress.kind).toBe("Ingress");
    expect(r.previewIngress.kind).toBe("Ingress");
    expect(r.agentIngress.metadata?.name).not.toBe(r.previewIngress.metadata?.name);
  });

  it("propagates ownerReferences onto Service + both Ingresses (cascade delete works)", () => {
    const r = buildSessionResources(SPEC, DEFAULT_OPTS);
    for (const res of [r.service, r.agentIngress, r.previewIngress]) {
      expect(res.metadata?.ownerReferences?.[0]?.uid).toBe(SAMPLE_OWNER.uid);
      expect(res.metadata?.ownerReferences?.[0]?.controller).toBe(false);
    }
  });

  it("only the agent Ingress carries the auth-injection snippet (regression guard)", () => {
    const r = buildSessionResources(SPEC, DEFAULT_OPTS);
    const agentSnippet =
      r.agentIngress.metadata?.annotations?.[
        "nginx.ingress.kubernetes.io/configuration-snippet"
      ];
    const previewSnippet =
      r.previewIngress.metadata?.annotations?.[
        "nginx.ingress.kubernetes.io/configuration-snippet"
      ];
    expect(agentSnippet).toBeDefined();
    expect(previewSnippet).toBeUndefined();
  });

  it("end-to-end env override yields agent + preview hosts under the configured domain", () => {
    vi.stubEnv("OPENVOID_DOMAIN_BASE", "foo.example.com");
    const r = buildSessionResources(SPEC, { authHeaderValue: AUTH_HEADER });
    expect(r.agentIngress.spec?.rules?.[0]?.host).toBe(
      `${SPEC.sessionId.toLowerCase()}.agent.foo.example.com`,
    );
    expect(r.previewIngress.spec?.rules?.[0]?.host).toBe(
      `${SPEC.sessionId.toLowerCase()}.preview.foo.example.com`,
    );
  });
});
