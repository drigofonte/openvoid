import type { V1ContainerStateTerminated, V1Pod } from "@kubernetes/client-node";
import type { components } from "@openvoid/protocol";
import {
  GIT_FINALIZER_CONTAINER_NAME,
  WORKSPACE_INIT_CONTAINER_NAME,
} from "./client.js";

type Session = components["schemas"]["Session"];
type SessionError = components["schemas"]["SessionError"];
type PendingPhase = components["schemas"]["PendingPhase"];
type SessionStatus = Session["status"];

// Pod.spec.containers[0].name from buildSessionPodManifest. Hard-coded
// here on purpose — the constant isn't currently exported from
// k8s/client.ts and duplicating the literal keeps the pod-status
// reader independent of manifest-builder refactors. If the agent
// container is ever renamed both sites need to update together;
// the test suite asserts the linkage indirectly via end-to-end pod
// fixtures.
const AGENT_CONTAINER_NAME = "session";

export type PodSessionState = Pick<Session, "status" | "pendingPhase" | "error">;

/**
 * Map a `V1Pod` snapshot to `{status, pendingPhase?, error?}`. The
 * GET /sessions/:id handler runs this and then layers ingress-URL
 * population on top.
 *
 * Failure detection is checked first, across all phases, so a
 * non-zero workspace-init exit or an agent CrashLoopBackOff surfaces
 * even when the broader pod phase still says "Pending" / "Running".
 *
 * v1 collapses the storyboard's "Cloning starter template" and
 * "Installing dependencies" into a single `seeding-scaffold` phase —
 * workspace-init does both inside one container with no file-marker
 * handoff to read. The `installing-deps` enum value is defined in
 * the protocol but currently unused; reserved for the v1.5 finer-
 * grained signal mentioned in plan §U9 approach (a) discussion.
 */
export function derivePodSessionState(pod: V1Pod): PodSessionState {
  const phase = pod.status?.phase;
  const initStatuses = pod.status?.initContainerStatuses ?? [];
  const containerStatuses = pod.status?.containerStatuses ?? [];
  const workspaceInit = initStatuses.find(
    (c) => c.name === WORKSPACE_INIT_CONTAINER_NAME,
  );
  // Reserved for future use — git-finalizer is a native sidecar
  // (initContainer with restartPolicy=Always) and is "running"
  // throughout the pod's life; no current phase keys off its state.
  void initStatuses.find((c) => c.name === GIT_FINALIZER_CONTAINER_NAME);
  const agent = containerStatuses.find((c) => c.name === AGENT_CONTAINER_NAME);

  // 1. Failure detection — highest priority. A non-zero exit on
  // workspace-init means the seed flow failed (clone, push,
  // pnpm install) and the pod will not progress.
  if (
    workspaceInit?.state?.terminated &&
    (workspaceInit.state.terminated.exitCode ?? 0) !== 0
  ) {
    return failed(
      "init_failed",
      terminationMessage(workspaceInit.state.terminated, WORKSPACE_INIT_CONTAINER_NAME),
    );
  }
  // CrashLoopBackOff is the kubelet's way of saying "this container
  // has crashed N times and we're backing off restarts". Once the
  // agent container is in this state, the session is unrecoverable
  // without a fresh start.
  if (
    agent?.state?.waiting?.reason === "CrashLoopBackOff" ||
    agent?.state?.waiting?.reason === "RunContainerError"
  ) {
    return failed(
      "agent_crashloop",
      agent.state.waiting.message ??
        `Agent container is ${agent.state.waiting.reason}.`,
    );
  }

  // 2. Terminal phases. `Succeeded` is the clean exit (e.g. operator
  // deletion ran through finalizer cleanly); `Failed` is the catch-
  // all for kubelet-level failures that didn't surface elsewhere.
  if (phase === "Succeeded") return { status: "Stopped" };
  if (phase === "Failed") {
    return failed("pod_failed", pod.status?.message ?? "Pod entered Failed phase.");
  }

  // 3. Pending — pod created, init containers running or queued.
  if (phase === "Pending") {
    if (workspaceInit?.state?.running) {
      return { status: "Pending", pendingPhase: "seeding-scaffold" };
    }
    if (
      workspaceInit?.state?.terminated &&
      (workspaceInit.state.terminated.exitCode ?? 0) === 0
    ) {
      // workspace-init done; agent main container is starting (the
      // git-finalizer native sidecar keeps running, doesn't gate this).
      return { status: "Pending", pendingPhase: "awaiting-dev-server" };
    }
    // Image pull / scheduling — nothing has started yet.
    return { status: "Pending", pendingPhase: "provisioning" };
  }

  // 4. Running — main container has started.
  if (phase === "Running") {
    if (agent && agent.ready === false) {
      // readinessProbe (only attached to new-app pods, see U8) has
      // not succeeded yet. For import-repo pods the agent has no
      // readinessProbe; `ready` defaults to true and we fall through.
      return { status: "Pending", pendingPhase: "awaiting-dev-server" };
    }
    // Ingress-URL gating (`running-pre-ingress`) happens client-side
    // in landing's gateOnIngressReadiness — session-api has no
    // first-class signal for "ingress-nginx has programmed the
    // host", and the May-09 learning warns against server-side
    // probing of public URLs (pod-loopback / nip.io trap).
    return { status: "Running" };
  }

  // Unknown phase (e.g. kubelet hasn't reported yet) — show
  // provisioning so the storyboard advances on the next poll.
  return { status: "Pending", pendingPhase: "provisioning" };
}

function failed(code: SessionError["code"], message: SessionError["message"]): PodSessionState {
  return { status: "Failed", error: { code, message } };
}

function terminationMessage(
  t: V1ContainerStateTerminated,
  container: string,
): string {
  const reason = t.reason ?? "non-zero exit";
  const exit = t.exitCode ?? 0;
  const detail = t.message ? `: ${t.message}` : "";
  return `${container} ${reason} (exit ${exit})${detail}`;
}
