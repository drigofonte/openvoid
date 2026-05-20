import { describe, it, expect } from "vitest";
import type {
  V1ContainerStatus,
  V1Pod,
} from "@kubernetes/client-node";
import { derivePodSessionState } from "../../src/k8s/pod-status.js";

type PodOverrides = {
  phase?: string;
  initContainerStatuses?: V1ContainerStatus[];
  containerStatuses?: V1ContainerStatus[];
  message?: string;
};

function makePod(overrides: PodOverrides = {}): V1Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "session-x", namespace: "openvoid-sessions" },
    status: {
      phase: overrides.phase,
      initContainerStatuses: overrides.initContainerStatuses,
      containerStatuses: overrides.containerStatuses,
      message: overrides.message,
    },
  };
}

function initRunning(name: string): V1ContainerStatus {
  return {
    name,
    image: "x:dev",
    imageID: "",
    ready: false,
    restartCount: 0,
    started: true,
    state: { running: { startedAt: new Date() } },
  };
}

function initTerminated(name: string, exitCode: number, reason?: string, message?: string): V1ContainerStatus {
  return {
    name,
    image: "x:dev",
    imageID: "",
    ready: false,
    restartCount: 0,
    state: { terminated: { exitCode, reason, message } },
  };
}

function agent({ ready, waitingReason }: { ready?: boolean; waitingReason?: string }): V1ContainerStatus {
  return {
    name: "session",
    image: "opencode:dev",
    imageID: "",
    ready: ready ?? true,
    restartCount: 0,
    started: true,
    state: waitingReason ? { waiting: { reason: waitingReason } } : { running: { startedAt: new Date() } },
  };
}

describe("derivePodSessionState", () => {
  it("Pending + workspace-init running → Pending / seeding-scaffold", () => {
    const pod = makePod({
      phase: "Pending",
      initContainerStatuses: [initRunning("workspace-init")],
    });
    expect(derivePodSessionState(pod)).toEqual({
      status: "Pending",
      pendingPhase: "seeding-scaffold",
    });
  });

  it("Pending + workspace-init terminated exit 0 → Pending / awaiting-dev-server", () => {
    const pod = makePod({
      phase: "Pending",
      initContainerStatuses: [initTerminated("workspace-init", 0)],
    });
    expect(derivePodSessionState(pod)).toEqual({
      status: "Pending",
      pendingPhase: "awaiting-dev-server",
    });
  });

  it("Pending with no init-container status yet → Pending / provisioning", () => {
    const pod = makePod({ phase: "Pending" });
    expect(derivePodSessionState(pod)).toEqual({
      status: "Pending",
      pendingPhase: "provisioning",
    });
  });

  it("Pending + workspace-init terminated non-zero → Failed / init_failed (with reason + exit + message)", () => {
    const pod = makePod({
      phase: "Pending",
      initContainerStatuses: [
        initTerminated("workspace-init", 128, "Error", "git push rejected by remote"),
      ],
    });
    const state = derivePodSessionState(pod);
    expect(state.status).toBe("Failed");
    expect(state.error?.code).toBe("init_failed");
    expect(state.error?.message).toContain("workspace-init");
    expect(state.error?.message).toContain("Error");
    expect(state.error?.message).toContain("128");
    expect(state.error?.message).toContain("git push rejected by remote");
    expect(state.pendingPhase).toBeUndefined();
  });

  it("Running + agent ready=true → Running (no pendingPhase, no error)", () => {
    const pod = makePod({
      phase: "Running",
      containerStatuses: [agent({ ready: true })],
    });
    expect(derivePodSessionState(pod)).toEqual({ status: "Running" });
  });

  it("Running + agent ready=false → Pending / awaiting-dev-server (readinessProbe still failing)", () => {
    const pod = makePod({
      phase: "Running",
      containerStatuses: [agent({ ready: false })],
    });
    expect(derivePodSessionState(pod)).toEqual({
      status: "Pending",
      pendingPhase: "awaiting-dev-server",
    });
  });

  it("Running + import-repo-style agent (no readinessProbe, ready=true by default) → Running", () => {
    // Import-repo pods skip the readinessProbe (per U8). The kubelet
    // defaults containerStatuses[].ready to true once the container
    // starts; we should treat that as Ready.
    const pod = makePod({
      phase: "Running",
      containerStatuses: [agent({ ready: true })],
    });
    expect(derivePodSessionState(pod)).toEqual({ status: "Running" });
  });

  it("Running + agent CrashLoopBackOff → Failed / agent_crashloop", () => {
    const pod = makePod({
      phase: "Running",
      containerStatuses: [agent({ ready: false, waitingReason: "CrashLoopBackOff" })],
    });
    const state = derivePodSessionState(pod);
    expect(state.status).toBe("Failed");
    expect(state.error?.code).toBe("agent_crashloop");
  });

  it("Running + agent RunContainerError also maps to Failed / agent_crashloop", () => {
    const pod = makePod({
      phase: "Running",
      containerStatuses: [agent({ ready: false, waitingReason: "RunContainerError" })],
    });
    expect(derivePodSessionState(pod).error?.code).toBe("agent_crashloop");
  });

  it("Succeeded → Stopped (no pendingPhase, no error)", () => {
    const pod = makePod({ phase: "Succeeded" });
    expect(derivePodSessionState(pod)).toEqual({ status: "Stopped" });
  });

  it("Failed → Failed / pod_failed (with pod-level message)", () => {
    const pod = makePod({ phase: "Failed", message: "exceeded activeDeadlineSeconds" });
    const state = derivePodSessionState(pod);
    expect(state.status).toBe("Failed");
    expect(state.error?.code).toBe("pod_failed");
    expect(state.error?.message).toContain("exceeded activeDeadlineSeconds");
  });

  it("Unknown phase → Pending / provisioning (storyboard keeps advancing on next poll)", () => {
    const pod = makePod({ phase: "Unknown" });
    expect(derivePodSessionState(pod)).toEqual({
      status: "Pending",
      pendingPhase: "provisioning",
    });
  });

  it("Init failure takes precedence over pod phase (Pending + init non-zero → Failed, not Pending)", () => {
    // Failure-detection ordering: even though phase is still Pending,
    // a non-zero workspace-init exit collapses the session to Failed
    // so landing renders the failed view instead of a stuck
    // Provisioning storyboard.
    const pod = makePod({
      phase: "Pending",
      initContainerStatuses: [initTerminated("workspace-init", 1, "Error")],
    });
    expect(derivePodSessionState(pod).status).toBe("Failed");
  });
});
