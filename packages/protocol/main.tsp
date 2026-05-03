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

@doc("Request body for creating a new coding session.")
model CreateSessionRequest {
  @doc("Git URL of the workspace to clone.")
  repo: string;

  @doc("Operator stops the session after this much inactivity. Defaults to 1800 (30 min).")
  @minValue(0)
  idleTimeoutSeconds?: int32 = 1800;
}

@doc("A coding session resource as exposed by the API.")
model Session {
  @doc("ULID identifying the session. Stable for the session's lifetime.")
  sessionId: string;

  @doc("Current lifecycle phase.")
  status: SessionPhase;

  @doc("Reachable URL of the agent (when status is Running). Empty until Phase 5/6.")
  endpointUrl?: string;
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
  @doc("Delete a session. Operator finalizer handles graceful shutdown.")
  op remove(@path id: string): {
    @statusCode statusCode: 204;
  } | ApiError;
}
