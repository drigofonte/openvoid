import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi";

using Http;
using Rest;
using OpenAPI;

@service(#{ title: "openvoid Session API" })
@info(#{ version: "0.1.0" })
namespace Openvoid;

@doc("Lifecycle phase of a coding session.")
enum SessionPhase {
  Pending,
  Running,
  Stopping,
  Stopped,
  Failed,
}

@doc("How the session's workspace is provisioned. `new-app` creates a fresh per-app repo on the platform GitHub org and seeds it from the canonical scaffold; `import-repo` clones a user-supplied HTTPS Git URL.")
enum SessionMode {
  @doc("Create a new app from the platform's canonical scaffold. `repo` MUST be absent on the request; `prompt` is optional and used to slugify the new repo's name and seed `app/scaffold-meta.json`.")
  newApp: "new-app",

  @doc("Clone a user-supplied HTTPS Git URL into the session workspace. `repo` is required.")
  importRepo: "import-repo",
}

@doc("Boot sub-phase the session is currently in. Populated only when `status == Pending`; surfaces real init/agent progress to the Provisioning storyboard instead of a synthetic timer.")
enum PendingPhase {
  @doc("Pod has been created but no init container has reported progress yet.")
  provisioning: "provisioning",

  @doc("workspace-init is cloning the scaffold template and seeding the per-app repo (new-app mode), or cloning the user repo (import-repo mode).")
  seedingScaffold: "seeding-scaffold",

  @doc("workspace-init has finished seeding and is running `pnpm install`. v1 collapses this with `seeding-scaffold` from the storyboard's perspective (single init container, no file-marker handoff); the enum value is reserved for a v1.5 finer-grained signal.")
  installingDeps: "installing-deps",

  @doc("Agent container has started and the dev server is booting. Session flips to `Running` when the port-3000 readinessProbe succeeds.")
  awaitingDevServer: "awaiting-dev-server",

  @doc("Pod is Ready inside the cluster but the per-session ingress URLs are not yet populated (Service endpoints or ingress-nginx programming lag).")
  runningPreIngress: "running-pre-ingress",
}

@doc("Request body for creating a new coding session.")
model CreateSessionRequest {
  @doc("How the workspace is provisioned. When `new-app`, `repo` MUST be omitted and `prompt` is optional. When `import-repo`, `repo` is required and `prompt` MUST be omitted. Server-side validation enforces this conditional rule (`isCreateRequest`) and rejects mismatches with `400 invalid_request`.")
  mode: SessionMode;

  @doc("HTTPS Git URL of the workspace to clone (e.g. `https://github.com/<org>/<repo>`). Required when `mode == \"import-repo\"`; rejected when `mode == \"new-app\"`. SSH URLs (`git@host:org/repo.git`) are not supported in v1.")
  repo?: string;

  @doc("Free-form natural-language description of the app the user wants to build. Used in `new-app` mode to slugify the repo name and seed `app/scaffold-meta.json`. Truncated at 500 chars client-side; slug truncation is enforced server-side. Empty is accepted (falls back to `app-<suffix>`). Ignored in `import-repo` mode.")
  prompt?: string;

  @doc("Branch to check out at clone time (import-repo only). Defaults to `main`.")
  branch?: string = "main";

  @doc("Operator stops the session after this much inactivity. Defaults to 1800 (30 min).")
  @minValue(0)
  idleTimeoutSeconds?: int32 = 1800;
}

@doc("Failure detail attached to a Session when `status == Failed`. `code` is the stable machine-readable identifier landing maps to user-facing copy; `message` is for logs/telemetry and is NOT rendered to the user verbatim.")
model SessionError {
  @doc("Stable error code (e.g. `init_failed`, `agent_crashloop`, `dev_server_unhealthy`, `github_rate_limited`, `k8s_unavailable`).")
  code: string;

  @doc("Human-readable detail. Intended for operator logs and telemetry; do not render directly in the UI — landing maps `code` to safe copy.")
  message: string;
}

@doc("A coding session resource as exposed by the API.")
model Session {
  @doc("ULID identifying the session. Stable for the session's lifetime.")
  sessionId: string;

  @doc("Current lifecycle phase.")
  status: SessionPhase;

  @doc("Boot sub-phase. Present only when `status == Pending`; absent on `Running`, `Stopped`, `Stopping`, and `Failed`. Drives the Provisioning storyboard's active step.")
  pendingPhase?: PendingPhase;

  @doc("Failure detail. Populated only when `status == Failed`; absent on every other status.")
  error?: SessionError;

  @doc("Reachable URL of the agent (when status is Running). Empty until Phase 5/6.")
  endpointUrl?: string;

  @doc("Public URL of the OpenCode agent UI. Populated when status is Running. Edge auth-injection means the link Just Works in a browser — no password prompt.")
  agentUrl?: url;

  @doc("Public URL of the user's live preview (typically port 3000). Populated when status is Running. Unauthenticated — anyone with the URL can reach the user's app.")
  previewUrl?: url;

  @doc("Git URL of the workspace cloned at session start.")
  repo?: string;

  @doc("Branch checked out at session start.")
  branch?: string;

  @doc("RFC 3339 timestamp the session was created.")
  createdAt?: string;
}

@doc("Standard error response.")
@error
model ApiError {
  @doc("Short machine-readable error code.")
  code: string;

  @doc("Human-readable message.")
  message: string;
}

@route("/sessions")
namespace Sessions {
  @post
  @doc("Create a new coding session. Returns 201 with the new session.")
  op create(@body body: CreateSessionRequest): {
    @statusCode statusCode: 201;
    @body session: Session;
  } | ApiError;

  @get
  @doc("Fetch a session by id.")
  op read(@path id: string): Session | ApiError;

  @delete
  @doc("Delete a session. Triggers Pod termination; the per-Pod git-finalizer sidecar pushes any edits to feat/<sessionId> during the grace period before exit.")
  op remove(@path id: string): {
    @statusCode statusCode: 204;
  } | ApiError;
}
