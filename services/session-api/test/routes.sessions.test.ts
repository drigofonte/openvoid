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

function podWith(phase: string, podIP?: string): V1Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "session-x", namespace: "openvoid-sessions" },
    status: { phase, podIP },
  };
}

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
      const manifest = buildSessionPodManifest(arg);
      expect(manifest.metadata?.labels).toEqual({
        [SESSION_LABEL]: arg.sessionId,
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      });
      expect(manifest.spec?.containers?.[0]?.image).toBe("nginx:alpine");
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

    it("rejects negative idleTimeoutSeconds with 400", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "x", idleTimeoutSeconds: -1 }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects non-finite idleTimeoutSeconds (NaN, Infinity) with 400", async () => {
      for (const v of ["NaN", "Infinity"]) {
        const res = await app.request("/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // JSON cannot encode NaN/Infinity; serialize the literal text instead.
          body: `{"repo":"x","idleTimeoutSeconds":${v}}`,
        });
        expect(res.status, `value=${v}`).toBe(400);
      }
    });

    it("accepts valid positive idleTimeoutSeconds", async () => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "x", idleTimeoutSeconds: 600 }),
      });
      expect(res.status).toBe(201);
    });

    it("returns 503 when the K8s client throws", async () => {
      ops.createSessionPod.mockRejectedValueOnce(new Error("apiserver unreachable"));
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: "x" }),
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
        body: JSON.stringify({ repo: "x" }),
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
