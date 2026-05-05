// Phase 7 follow-up — focused tests for K8sSessionOps. The class wraps
// the @kubernetes/client-node API and orchestrates Pod + Service +
// Ingress creation/deletion with rollback semantics. Pure builder
// behavior is covered in ingress.test.ts; this file exercises the
// orchestration: order of operations, rollback on partial create
// failure, and 404 swallowing during delete.

import { describe, it, expect, vi } from "vitest";
import type {
  CoreV1Api,
  NetworkingV1Api,
  V1Ingress,
  V1Pod,
  V1Service,
} from "@kubernetes/client-node";
import {
  K8sSessionOps,
  OPENCODE_IMAGE,
  type SessionPodSpec,
} from "../../src/k8s/client.js";

const SPEC: SessionPodSpec = {
  sessionId: "01HABCDEF",
  image: OPENCODE_IMAGE,
  repo: "https://github.com/example/x",
};

const AUTH_HEADER = "Basic b3BlbmNvZGU6dGVzdA==";

function makePod(): V1Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: "session-01habcdef",
      namespace: "openvoid-sessions",
      uid: "uid-test-1234",
    },
  };
}

type MockCore = {
  createNamespacedPod: ReturnType<typeof vi.fn>;
  createNamespacedService: ReturnType<typeof vi.fn>;
  deleteNamespacedPod: ReturnType<typeof vi.fn>;
  deleteNamespacedService: ReturnType<typeof vi.fn>;
  listNamespacedPod: ReturnType<typeof vi.fn>;
};

type MockNetworking = {
  createNamespacedIngress: ReturnType<typeof vi.fn>;
  deleteNamespacedIngress: ReturnType<typeof vi.fn>;
};

function setupMocks(): { ops: K8sSessionOps; core: MockCore; networking: MockNetworking } {
  const core: MockCore = {
    createNamespacedPod: vi.fn(async () => makePod()),
    createNamespacedService: vi.fn(async (): Promise<V1Service> => ({ kind: "Service" })),
    deleteNamespacedPod: vi.fn(async () => undefined),
    deleteNamespacedService: vi.fn(async () => undefined),
    listNamespacedPod: vi.fn(async () => ({ items: [makePod()] })),
  };
  const networking: MockNetworking = {
    createNamespacedIngress: vi.fn(async (): Promise<V1Ingress> => ({ kind: "Ingress" })),
    deleteNamespacedIngress: vi.fn(async () => undefined),
  };
  const ops = new K8sSessionOps(
    core as unknown as CoreV1Api,
    networking as unknown as NetworkingV1Api,
    AUTH_HEADER,
  );
  return { ops, core, networking };
}

const NOT_FOUND = Object.assign(new Error("not found"), { code: 404 });

describe("K8sSessionOps.createSessionResources", () => {
  it("creates Pod, Service, and both Ingresses on the happy path", async () => {
    const { ops, core, networking } = setupMocks();
    const r = await ops.createSessionResources(SPEC);
    expect(core.createNamespacedPod).toHaveBeenCalledOnce();
    expect(core.createNamespacedService).toHaveBeenCalledOnce();
    expect(networking.createNamespacedIngress).toHaveBeenCalledTimes(2);
    expect(r.pod).toBeDefined();
    expect(r.service).toBeDefined();
    expect(r.agentIngress).toBeDefined();
    expect(r.previewIngress).toBeDefined();
    // Rollback should not fire on the happy path.
    expect(core.deleteNamespacedPod).not.toHaveBeenCalled();
  });

  it("rolls back the Pod when Service creation fails, then rethrows", async () => {
    const { ops, core, networking } = setupMocks();
    core.createNamespacedService.mockRejectedValueOnce(new Error("apiserver unreachable"));
    await expect(ops.createSessionResources(SPEC)).rejects.toThrow(/apiserver unreachable/);
    // Pod created, then deleted to clean up after the failed Service create.
    expect(core.createNamespacedPod).toHaveBeenCalledOnce();
    expect(core.deleteNamespacedPod).toHaveBeenCalledOnce();
    // Ingress creation never reached.
    expect(networking.createNamespacedIngress).not.toHaveBeenCalled();
  });

  it("rolls back the Pod when the agent Ingress creation fails", async () => {
    const { ops, core, networking } = setupMocks();
    networking.createNamespacedIngress
      .mockRejectedValueOnce(new Error("ingress denied"));
    await expect(ops.createSessionResources(SPEC)).rejects.toThrow(/ingress denied/);
    expect(core.deleteNamespacedPod).toHaveBeenCalledOnce();
  });

  it("rolls back the Pod when the preview Ingress (last step) fails", async () => {
    const { ops, core, networking } = setupMocks();
    networking.createNamespacedIngress
      .mockResolvedValueOnce({ kind: "Ingress" } as V1Ingress) // agent ok
      .mockRejectedValueOnce(new Error("preview ingress denied"));
    await expect(ops.createSessionResources(SPEC)).rejects.toThrow(/preview ingress denied/);
    expect(core.deleteNamespacedPod).toHaveBeenCalledOnce();
  });

  it("does not shadow the original error when rollback delete itself fails", async () => {
    const { ops, core } = setupMocks();
    core.createNamespacedService.mockRejectedValueOnce(new Error("real cause"));
    core.deleteNamespacedPod.mockRejectedValueOnce(new Error("rollback also failed"));
    // The caller sees the original create error, not the rollback failure.
    await expect(ops.createSessionResources(SPEC)).rejects.toThrow(/real cause/);
  });
});

describe("K8sSessionOps.deleteSessionResources", () => {
  it("deletes both Ingresses, the Service, and the Pod in sequence", async () => {
    const { ops, core, networking } = setupMocks();
    const ok = await ops.deleteSessionResources(SPEC.sessionId);
    expect(ok).toBe(true);
    expect(networking.deleteNamespacedIngress).toHaveBeenCalledTimes(2);
    expect(core.deleteNamespacedService).toHaveBeenCalledOnce();
    expect(core.deleteNamespacedPod).toHaveBeenCalledOnce();
  });

  it("returns false when no Pod exists for the session ID", async () => {
    const { ops, core } = setupMocks();
    core.listNamespacedPod.mockResolvedValueOnce({ items: [] });
    const ok = await ops.deleteSessionResources(SPEC.sessionId);
    expect(ok).toBe(false);
    expect(core.deleteNamespacedPod).not.toHaveBeenCalled();
  });

  it("swallows 404 from concurrent Ingress GC and continues with the rest", async () => {
    const { ops, core, networking } = setupMocks();
    networking.deleteNamespacedIngress.mockRejectedValueOnce(NOT_FOUND);
    const ok = await ops.deleteSessionResources(SPEC.sessionId);
    expect(ok).toBe(true);
    // Even with the first Ingress 404, the Service + Pod still get deleted.
    expect(core.deleteNamespacedService).toHaveBeenCalledOnce();
    expect(core.deleteNamespacedPod).toHaveBeenCalledOnce();
  });

  it("swallows 404 on the Pod delete (race with GC / external delete)", async () => {
    const { ops, core } = setupMocks();
    core.deleteNamespacedPod.mockRejectedValueOnce(NOT_FOUND);
    const ok = await ops.deleteSessionResources(SPEC.sessionId);
    // The user's intent ("make this gone") is satisfied — return true.
    expect(ok).toBe(true);
  });

  it("rethrows non-404 errors during deletion", async () => {
    const { ops, core } = setupMocks();
    core.deleteNamespacedService.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { code: 403 }),
    );
    await expect(ops.deleteSessionResources(SPEC.sessionId)).rejects.toThrow(/forbidden/);
  });
});
