// Pure state machine for the landing page. Keeping the logic out of
// app.ts (DOM wiring) lets vitest exercise transitions without happy-dom.
//
// idle ──create()──▶ creating ──onRunning()──▶ ready
//   ▲                                            │
//   └────────────────onStopped()──── stopping ◀──┘
//                                       │
//                              stop() returns 404 / pod gone

import type { Session } from "./api.js";

export type View =
  | { kind: "idle"; error?: string }
  | { kind: "creating"; sessionId: string }
  | { kind: "ready"; session: Session }
  | { kind: "stopping"; sessionId: string };

export class LandingState {
  private listeners: Array<(v: View) => void> = [];
  private current: View = { kind: "idle" };

  subscribe(fn: (v: View) => void): () => void {
    this.listeners.push(fn);
    fn(this.current);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  get(): View {
    return this.current;
  }

  set(view: View): void {
    this.current = view;
    for (const l of this.listeners) l(view);
  }

  // Convenience transitions — all dispatchable from app.ts in response
  // to user actions or polling results.

  toIdle(error?: string): void {
    this.set({ kind: "idle", error });
  }

  toCreating(sessionId: string): void {
    this.set({ kind: "creating", sessionId });
  }

  // Promote to `ready` only when the API confirms Running AND the
  // public URLs have been populated (Unit 7.3 contract). Returns true
  // if the transition fired.
  onSession(session: Session): boolean {
    if (session.status === "Running" && session.agentUrl && session.previewUrl) {
      this.set({ kind: "ready", session });
      return true;
    }
    if (session.status === "Failed") {
      this.toIdle(`Session failed to start (status=${session.status}).`);
      return true;
    }
    if (session.status === "Stopped") {
      // Pod terminated before we got a chance to use it.
      this.toIdle("Session stopped before becoming ready.");
      return true;
    }
    return false;
  }

  toStopping(sessionId: string): void {
    this.set({ kind: "stopping", sessionId });
  }
}
