// Phase 7.4 — light test on the state machine. The landing page is
// throwaway, so the test surface is intentionally small: just the
// transitions that drive the user-visible flow.

import { describe, it, expect } from "vitest";
import { LandingState, type View } from "../src/state.js";
import type { Session } from "../src/api.js";

function runningSessionWithUrls(): Session {
  return {
    sessionId: "01HABCDEF",
    status: "Running",
    agentUrl: "http://01habcdef.agent.127.0.0.1.nip.io/",
    previewUrl: "http://01habcdef.preview.127.0.0.1.nip.io/",
  };
}

describe("LandingState", () => {
  it("starts as idle with no error", () => {
    const s = new LandingState();
    expect(s.get()).toEqual({ kind: "idle" });
  });

  it("walks idle → creating → ready when the session reaches Running with URLs", () => {
    const s = new LandingState();
    const observed: View[] = [];
    s.subscribe((v) => observed.push(v));

    s.toCreating("01HABCDEF");
    expect(s.get().kind).toBe("creating");

    const fired = s.onSession(runningSessionWithUrls());
    expect(fired).toBe(true);
    expect(s.get().kind).toBe("ready");

    expect(observed.map((v) => v.kind)).toEqual(["idle", "creating", "ready"]);
  });

  it("does not promote to ready while status is Pending (URL fields absent)", () => {
    const s = new LandingState();
    s.toCreating("01HABCDEF");
    const fired = s.onSession({ sessionId: "01HABCDEF", status: "Pending" });
    expect(fired).toBe(false);
    expect(s.get().kind).toBe("creating");
  });

  it("does not promote to ready when status is Running but URLs aren't populated yet", () => {
    // Defends Unit 7.3's status-gated URL contract: agentUrl/previewUrl
    // appear only after the per-session Ingress is programmed. Until
    // then the API may briefly return Running without URLs.
    const s = new LandingState();
    s.toCreating("01HABCDEF");
    const fired = s.onSession({ sessionId: "01HABCDEF", status: "Running" });
    expect(fired).toBe(false);
    expect(s.get().kind).toBe("creating");
  });

  it("falls back to idle with an error when the session reaches Failed", () => {
    const s = new LandingState();
    s.toCreating("01HABCDEF");
    s.onSession({ sessionId: "01HABCDEF", status: "Failed" });
    expect(s.get()).toMatchObject({ kind: "idle" });
    expect((s.get() as { error?: string }).error).toMatch(/failed/i);
  });

  it("transitions ready → stopping on user-driven stop", () => {
    const s = new LandingState();
    s.set({ kind: "ready", session: runningSessionWithUrls() });
    s.toStopping("01HABCDEF");
    expect(s.get().kind).toBe("stopping");
  });
});
