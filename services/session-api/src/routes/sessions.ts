import { Hono } from "hono";
import id128 from "id128";
import type { components } from "@openvoid/protocol";
import type { PodOps } from "../k8s/client.js";

const { Ulid } = id128;

type CreateSessionRequest = components["schemas"]["CreateSessionRequest"];
type Session = components["schemas"]["Session"];
type ApiError = components["schemas"]["ApiError"];

const STUB_IMAGE = process.env.OPENVOID_STUB_IMAGE ?? "nginx:alpine";

function podPhaseToSessionStatus(phase: string | undefined): Session["status"] {
  switch (phase) {
    case "Running":
      return "Running";
    case "Succeeded":
      return "Stopped";
    case "Failed":
      return "Failed";
    default:
      return "Pending";
  }
}

function isCreateRequest(body: unknown): body is CreateSessionRequest {
  if (!body || typeof body !== "object") return false;
  const r = body as Record<string, unknown>;
  if (typeof r.repo !== "string" || r.repo.length === 0) return false;
  if (
    r.idleTimeoutSeconds !== undefined &&
    (typeof r.idleTimeoutSeconds !== "number" || r.idleTimeoutSeconds < 0)
  ) {
    return false;
  }
  return true;
}

function jsonError(code: string, message: string): ApiError {
  return { code, message };
}

export function sessionsRouter(podOps: PodOps): Hono {
  const app = new Hono();

  app.post("/sessions", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(jsonError("invalid_body", "Request body must be JSON"), 400);
    }

    if (!isCreateRequest(body)) {
      return c.json(
        jsonError(
          "invalid_request",
          "Body must include `repo` (non-empty string) and optional non-negative `idleTimeoutSeconds`",
        ),
        400,
      );
    }

    const sessionId = Ulid.generate().toCanonical();
    try {
      await podOps.createSessionPod({ sessionId, image: STUB_IMAGE });
    } catch (err) {
      return c.json(
        jsonError("k8s_unavailable", `Failed to create pod: ${(err as Error).message}`),
        503,
      );
    }

    const session: Session = { sessionId, status: "Pending" };
    return c.json(session, 201);
  });

  app.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    let pod;
    try {
      pod = await podOps.getSessionPod(id);
    } catch (err) {
      return c.json(
        jsonError("k8s_unavailable", `Failed to get pod: ${(err as Error).message}`),
        503,
      );
    }
    if (!pod) {
      return c.json(jsonError("not_found", `Session ${id} not found`), 404);
    }

    const session: Session = {
      sessionId: id,
      status: podPhaseToSessionStatus(pod.status?.phase),
    };
    const ip = pod.status?.podIP;
    if (ip) session.endpointUrl = `http://${ip}`;
    return c.json(session, 200);
  });

  app.delete("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    let deleted: boolean;
    try {
      deleted = await podOps.deleteSessionPod(id);
    } catch (err) {
      return c.json(
        jsonError("k8s_unavailable", `Failed to delete pod: ${(err as Error).message}`),
        503,
      );
    }
    if (!deleted) {
      return c.json(jsonError("not_found", `Session ${id} not found`), 404);
    }
    return c.body(null, 204);
  });

  return app;
}
