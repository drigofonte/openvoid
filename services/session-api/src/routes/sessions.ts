import { Hono } from "hono";
import id128 from "id128";
import type { components } from "@openvoid/protocol";
import {
  type SessionOps,
  OPENCODE_IMAGE,
  REPO_ANNOTATION,
  BRANCH_ANNOTATION,
  CREATED_AT_ANNOTATION,
  agentUrl,
  previewUrl,
} from "../k8s/client.js";

const { Ulid } = id128;

type CreateSessionRequest = components["schemas"]["CreateSessionRequest"];
type Session = components["schemas"]["Session"];
type ApiError = components["schemas"]["ApiError"];

const SESSION_MODES = ["new-app", "import-repo"] as const;
type SessionMode = (typeof SESSION_MODES)[number];

function isSessionMode(value: unknown): value is SessionMode {
  return typeof value === "string" && (SESSION_MODES as readonly string[]).includes(value);
}

// Read OPENVOID_STUB_IMAGE at request time (not module load) so tests
// can flip it via vi.stubEnv without re-importing. The Phase 5 demo
// flow continues to set this to nginx:alpine to bypass OpenCode for
// lifecycle-only debugging.
function sessionImage(): string {
  return process.env.OPENVOID_STUB_IMAGE ?? OPENCODE_IMAGE;
}

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

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isCreateRequest(body: unknown): body is CreateSessionRequest {
  if (!body || typeof body !== "object") return false;
  const r = body as Record<string, unknown>;

  if (!isSessionMode(r.mode)) return false;

  // mode/repo/prompt conditional: import-repo requires a valid HTTPS
  // repo URL and forbids prompt; new-app forbids repo and allows an
  // optional prompt. The protocol expresses this in prose; the
  // type-guard enforces it.
  if (r.mode === "import-repo") {
    if (typeof r.repo !== "string" || r.repo.length === 0) return false;
    if (!isHttpsUrl(r.repo)) return false;
    if (r.prompt !== undefined) return false;
  } else {
    if (r.repo !== undefined) return false;
    if (r.prompt !== undefined && typeof r.prompt !== "string") return false;
  }

  if (r.branch !== undefined) {
    if (typeof r.branch !== "string" || r.branch.length === 0) return false;
  }
  if (r.idleTimeoutSeconds !== undefined) {
    if (typeof r.idleTimeoutSeconds !== "number") return false;
    if (!Number.isFinite(r.idleTimeoutSeconds) || r.idleTimeoutSeconds < 0) return false;
  }
  return true;
}

function jsonError(code: string, message: string): ApiError {
  return { code, message };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

export function sessionsRouter(sessionOps: SessionOps): Hono {
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
          "Body must include `mode` (one of `new-app`, `import-repo`). When `mode == \"import-repo\"`, `repo` is required as an HTTPS Git URL (e.g. `https://github.com/<org>/<repo>`; SSH URLs are not supported) and `prompt` is forbidden. When `mode == \"new-app\"`, `repo` is forbidden and `prompt` is an optional string. `branch` (non-empty string) and `idleTimeoutSeconds` (non-negative finite number) are optional.",
        ),
        400,
      );
    }

    // U4 lands the type-guard; the new-app handler ships in U6. Until
    // then, accept the request at the protocol layer but surface a
    // clear 501 to landing so the flow can't silently no-op.
    if (body.mode === "new-app") {
      return c.json(
        jsonError(
          "not_implemented_yet",
          "The new-app entry point is being wired up. Track its progress in docs/plans/2026-05-12-002-feat-coding-session-scaffold-bootstrap-plan.md.",
        ),
        501,
      );
    }

    const sessionId = Ulid.generate().toCanonical();
    try {
      await sessionOps.createSessionResources({
        sessionId,
        image: sessionImage(),
        repo: body.repo!,
        branch: body.branch,
      });
    } catch (err) {
      return c.json(
        jsonError("k8s_unavailable", `Failed to create session resources: ${errorMessage(err)}`),
        503,
      );
    }

    const session: Session = { sessionId, status: "Pending" };
    return c.json(session, 201);
  });

  app.get("/sessions/:id", async (c) => {
    const sessionId = c.req.param("id");
    let pod;
    try {
      pod = await sessionOps.getSessionPod(sessionId);
    } catch (err) {
      return c.json(
        jsonError("k8s_unavailable", `Failed to get pod: ${errorMessage(err)}`),
        503,
      );
    }
    if (!pod) {
      return c.json(jsonError("not_found", `Session ${sessionId} not found`), 404);
    }

    const session: Session = {
      sessionId,
      status: podPhaseToSessionStatus(pod.status?.phase),
    };
    const ip = pod.status?.podIP;
    if (ip) session.endpointUrl = `http://${ip}`;

    // Surface the public URLs once the pod is Running. Until then the
    // routing isn't ready (Service has no endpoints, ingress-nginx may
    // not have programmed the hosts yet) — better to omit the fields
    // than to hand the landing page links that 502 for the first few
    // seconds.
    if (session.status === "Running") {
      session.agentUrl = agentUrl(sessionId);
      session.previewUrl = previewUrl(sessionId);
    }

    const annotations = pod.metadata?.annotations ?? {};
    const repo = annotations[REPO_ANNOTATION];
    const branch = annotations[BRANCH_ANNOTATION];
    const createdAt = annotations[CREATED_AT_ANNOTATION];
    if (repo) session.repo = repo;
    if (branch) session.branch = branch;
    if (createdAt) session.createdAt = createdAt;

    return c.json(session, 200);
  });

  app.delete("/sessions/:id", async (c) => {
    const sessionId = c.req.param("id");
    let deleted: boolean;
    try {
      deleted = await sessionOps.deleteSessionResources(sessionId);
    } catch (err) {
      return c.json(
        jsonError("k8s_unavailable", `Failed to delete session resources: ${errorMessage(err)}`),
        503,
      );
    }
    if (!deleted) {
      return c.json(jsonError("not_found", `Session ${sessionId} not found`), 404);
    }
    return c.body(null, 204);
  });

  return app;
}
