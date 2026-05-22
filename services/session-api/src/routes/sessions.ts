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
import { derivePodSessionState } from "../k8s/pod-status.js";
import {
  type GithubClient,
  createAppRepo,
  slugify,
  RepoNameCollision,
  GithubRateLimited,
  GithubClientError,
  GithubServerError,
} from "../lib/github.js";
import { IdempotencyCache } from "../lib/idempotency.js";

const { Ulid } = id128;

type CreateSessionRequest = components["schemas"]["CreateSessionRequest"];
type Session = components["schemas"]["Session"];
type ApiError = components["schemas"]["ApiError"];

const SESSION_MODES = ["new-app", "import-repo"] as const;
type SessionMode = (typeof SESSION_MODES)[number];

// Bounded retries for `RepoNameCollision`. With a 6-char random
// suffix from a 24-char alphabet (~191M values), three rolls already
// pushes the collision probability below 1 in 10^21 for any realistic
// per-org repo count. After 3, the failure is more likely the org
// runs out of name space than the suffix collides — surface 500.
const REPO_CREATE_MAX_ATTEMPTS = 3;

const IDEMPOTENCY_HEADER = "Idempotency-Key";

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

export type SessionsRouterDeps = {
  sessionOps: SessionOps;
  // Optional — when absent (operator hasn't run the platform-org
  // runbook), the new-app entry point returns 501 instead of crashing.
  newAppContext?: {
    org: string;
    github: GithubClient;
  };
  // Optional override for tests; defaults to a fresh in-process cache.
  idempotencyCache?: IdempotencyCache<Session, { status: number; body: ApiError }>;
};

export function sessionsRouter(
  arg: SessionOps | SessionsRouterDeps,
): Hono {
  const deps: SessionsRouterDeps =
    typeof (arg as SessionsRouterDeps).sessionOps === "object"
      ? (arg as SessionsRouterDeps)
      : { sessionOps: arg as SessionOps };
  const { sessionOps, newAppContext } = deps;
  const idempotency =
    deps.idempotencyCache ??
    new IdempotencyCache<Session, { status: number; body: ApiError }>();

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

    // Idempotency handling. Header is opportunistic — landing always
    // sends one; ad-hoc callers may omit it and accept duplicate-create
    // risk on their own retries. When present, the cache dedupes
    // identical requests within the 5-minute TTL window.
    const idemKey = c.req.header(IDEMPOTENCY_HEADER);
    if (idemKey) {
      const reservation = idempotency.reserve(idemKey);
      if (!reservation.fresh) {
        const prior = reservation.prior;
        if (prior.kind === "in-flight") {
          return c.json(
            jsonError(
              "idempotency_in_flight",
              `An earlier request with Idempotency-Key=${idemKey} is still being processed. Retry shortly.`,
            ),
            409,
          );
        }
        if (prior.kind === "completed") {
          return c.json(prior.value, 201);
        }
        return c.json(prior.error.body, prior.error.status as 400 | 409 | 500 | 501 | 503);
      }
    }

    const release = (next: () => Response | Promise<Response>) => async () => {
      try {
        const res = await next();
        return res;
      } finally {
        // Defensive: if the handler crashed in a way that left the
        // key reserved as in-flight (no complete/fail call), drop the
        // reservation so the next retry can proceed.
        if (idemKey) {
          const peek = idempotency.get(idemKey);
          if (peek?.kind === "in-flight") idempotency.forget(idemKey);
        }
      }
    };

    if (body.mode === "new-app") {
      return release(() => handleNewApp(body, idemKey))();
    }

    return release(() => handleImportRepo(body, idemKey))();
  });

  async function handleImportRepo(
    body: CreateSessionRequest,
    idemKey: string | undefined,
  ): Promise<Response> {
    const sessionId = Ulid.generate().toCanonical();
    try {
      await sessionOps.createSessionResources({
        sessionId,
        image: sessionImage(),
        repo: body.repo!,
        branch: body.branch,
      });
    } catch (err) {
      const failure = {
        status: 503,
        body: jsonError(
          "k8s_unavailable",
          `Failed to create session resources: ${errorMessage(err)}`,
        ),
      };
      if (idemKey) idempotency.fail(idemKey, failure);
      return jsonResponse(failure.body, 503);
    }
    const session: Session = { sessionId, status: "Pending" };
    if (idemKey) idempotency.complete(idemKey, session);
    return jsonResponse(session, 201);
  }

  async function handleNewApp(
    body: CreateSessionRequest,
    idemKey: string | undefined,
  ): Promise<Response> {
    if (!newAppContext) {
      const failure = {
        status: 501,
        body: jsonError(
          "not_implemented_yet",
          "The new-app entry point is not configured on this Session API instance. " +
            "Set OPENVOID_PLATFORM_GITHUB_ORG and provision the github-platform-creds Secret " +
            "(see docs/runbooks/platform-github-org-setup.md), then restart the Deployment.",
        ),
      };
      if (idemKey) idempotency.fail(idemKey, failure);
      return jsonResponse(failure.body, 501);
    }

    const { org, github } = newAppContext;
    const prompt = body.prompt ?? "";

    let repo: Awaited<ReturnType<typeof createAppRepo>> | undefined;
    let lastCollision: RepoNameCollision | undefined;
    for (let attempt = 1; attempt <= REPO_CREATE_MAX_ATTEMPTS; attempt += 1) {
      const baseName = slugify(prompt);
      try {
        repo = await createAppRepo(github, {
          org,
          baseName,
          description: prompt.length > 0 ? `openvoid app: ${prompt}` : "openvoid app",
        });
        break;
      } catch (err) {
        if (err instanceof RepoNameCollision) {
          lastCollision = err;
          continue;
        }
        const failure = mapGithubFailure(err);
        if (idemKey) idempotency.fail(idemKey, failure);
        return jsonResponse(failure.body, failure.status, failure.headers);
      }
    }

    if (!repo) {
      const failure = {
        status: 500,
        body: jsonError(
          "repo_name_collision",
          `Could not allocate a unique repo name under ${org} after ${REPO_CREATE_MAX_ATTEMPTS} attempts ` +
            `(last collision: ${lastCollision?.attemptedName ?? "unknown"}). Retry shortly.`,
        ),
      };
      if (idemKey) idempotency.fail(idemKey, failure);
      return jsonResponse(failure.body, 500);
    }

    const sessionId = Ulid.generate().toCanonical();
    try {
      await sessionOps.createSessionResources({
        sessionId,
        image: sessionImage(),
        repo: repo.cloneUrl,
        branch: body.branch,
        isNewApp: true,
        prompt,
      });
    } catch (err) {
      // GitHub repo persists (orphan); v1 accepts this — runbook only.
      const failure = {
        status: 503,
        body: jsonError(
          "k8s_unavailable",
          `Failed to create session resources: ${errorMessage(err)}`,
        ),
      };
      if (idemKey) idempotency.fail(idemKey, failure);
      return jsonResponse(failure.body, 503);
    }

    const session: Session = {
      sessionId,
      status: "Pending",
      pendingPhase: "provisioning",
      repo: repo.cloneUrl,
    };
    if (idemKey) idempotency.complete(idemKey, session);
    return jsonResponse(session, 201);
  }

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

    const derived = derivePodSessionState(pod);
    const session: Session = {
      sessionId,
      status: derived.status,
      ...(derived.pendingPhase ? { pendingPhase: derived.pendingPhase } : {}),
      ...(derived.error ? { error: derived.error } : {}),
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

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mapGithubFailure(err: unknown): {
  status: number;
  body: ApiError;
  headers?: Record<string, string>;
} {
  if (err instanceof GithubRateLimited) {
    const headers: Record<string, string> = {};
    if (err.resetAt) {
      const seconds = Math.max(1, Math.ceil((err.resetAt.getTime() - Date.now()) / 1000));
      headers["Retry-After"] = String(seconds);
    } else {
      headers["Retry-After"] = "60";
    }
    return {
      status: 503,
      body: jsonError(
        "github_rate_limited",
        "GitHub API rate limit reached while creating the per-app repo. Retry after the window resets.",
      ),
      headers,
    };
  }
  if (err instanceof GithubClientError) {
    return {
      status: 502,
      body: jsonError(
        "github_client_error",
        `GitHub rejected the repo-create request: ${err.message}`,
      ),
    };
  }
  if (err instanceof GithubServerError) {
    return {
      status: 502,
      body: jsonError(
        "github_unavailable",
        `GitHub failed the repo-create request: ${err.message}`,
      ),
    };
  }
  return {
    status: 500,
    body: jsonError("internal_error", `Unexpected error: ${errorMessage(err)}`),
  };
}
