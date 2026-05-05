// DOM glue. Keeps the state machine in state.ts and the API client in
// api.ts. This file stays small — the throwaway landing page doesn't
// merit a framework.

import "./styles.css";
import { ApiCallError, api, type Session } from "./api.js";
import { LandingState, type View } from "./state.js";

const state = new LandingState();

// Polling: 1s for the first 30s (covers the slowest Pending→Running
// transitions on a cold cluster — image pull, init container clone),
// then 5s. Capped at the documented 90s; after that the user gets a
// "still pending — check pod logs" failure path.
const POLL_FAST_MS = 1000;
const POLL_SLOW_MS = 5000;
const POLL_FAST_WINDOW_MS = 30_000;
const POLL_TIMEOUT_MS = 90_000;
const STOP_POLL_TIMEOUT_MS = 30_000;
const STOP_POLL_INTERVAL_MS = 1500;

function $<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

function setVisible(id: string, visible: boolean): void {
  $<HTMLElement>(`#${id}`).hidden = !visible;
}

function showError(msg: string): void {
  const banner = $<HTMLElement>("#error");
  banner.textContent = msg;
  banner.hidden = false;
}

function clearError(): void {
  const banner = $<HTMLElement>("#error");
  banner.textContent = "";
  banner.hidden = true;
}

function render(view: View): void {
  setVisible("state-idle", view.kind === "idle");
  setVisible("state-creating", view.kind === "creating");
  setVisible("state-ready", view.kind === "ready");
  setVisible("state-stopping", view.kind === "stopping");

  if (view.kind === "idle") {
    if (view.error) showError(view.error);
    else clearError();
  }
  if (view.kind === "ready") {
    const agent = $<HTMLAnchorElement>("#agent-link");
    const preview = $<HTMLAnchorElement>("#preview-link");
    agent.href = view.session.agentUrl ?? "#";
    preview.href = view.session.previewUrl ?? "#";
  }
  if (view.kind === "stopping") {
    $<HTMLElement>("#stopping-branch").textContent = `feat/${view.sessionId.toLowerCase()}`;
  }
}

state.subscribe(render);

// Active polling loop's abort controller. The stop handler aborts this
// before issuing DELETE so a late getSession() response from a still-in-
// flight pollUntilReady can't flip state back to "ready" after we've
// already moved to "stopping".
let activePoll: AbortController | null = null;

function startPoll(): AbortSignal {
  activePoll?.abort();
  activePoll = new AbortController();
  return activePoll.signal;
}

function endPoll(signal: AbortSignal): void {
  // Only clear the slot if the controller we own is still the active one
  // (a newer poll could have replaced us between turns).
  if (activePoll?.signal === signal) activePoll = null;
}

async function pollUntilReady(sessionId: string): Promise<void> {
  const signal = startPoll();
  const start = Date.now();
  try {
    while (!signal.aborted) {
      const elapsed = Date.now() - start;
      if (elapsed > POLL_TIMEOUT_MS) {
        state.toIdle(
          `Session ${sessionId} didn't reach Running within ${POLL_TIMEOUT_MS / 1000}s. ` +
            `Check pod logs in the cluster.`,
        );
        return;
      }
      let session: Session;
      try {
        session = await api.getSession(sessionId, signal);
      } catch (err) {
        if (signal.aborted) return;
        const msg = err instanceof ApiCallError ? err.message : "API unreachable";
        state.toIdle(`Lost contact with the Session API while polling: ${msg}`);
        return;
      }
      if (signal.aborted) return;
      if (state.onSession(session)) return;
      const interval = elapsed < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;
      await sleep(interval, signal);
    }
  } finally {
    endPoll(signal);
  }
}

async function pollUntilGone(sessionId: string): Promise<void> {
  const signal = startPoll();
  const start = Date.now();
  try {
    while (!signal.aborted && Date.now() - start < STOP_POLL_TIMEOUT_MS) {
      try {
        await api.getSession(sessionId, signal);
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiCallError && err.status === 404) {
          state.toIdle();
          return;
        }
      }
      await sleep(STOP_POLL_INTERVAL_MS, signal);
    }
    if (signal.aborted) return;
    // The pod might still be terminating; either way, drop back to idle
    // so the user can move on.
    state.toIdle();
  } finally {
    endPoll(signal);
  }
}

// Sleep that resolves early if the signal aborts. Required so the loops
// react to a stop click within ms, not at the end of a 5 s polling tick.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// --- handlers ---

const createForm = $<HTMLFormElement>("#create-form");
const submitButton = createForm.querySelector<HTMLButtonElement>("button[type=submit]");

createForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  // Guard against a double-click while the create request is in flight.
  // Form inputs/button stay enabled across the await boundary, so without
  // this guard a quick second click would spawn a duplicate session.
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;
  clearError();
  const repo = $<HTMLInputElement>("#repo").value.trim();
  const branchInput = $<HTMLInputElement>("#branch").value.trim();
  if (!repo) {
    showError("Repository URL is required.");
    if (submitButton) submitButton.disabled = false;
    return;
  }
  const branch = branchInput.length > 0 ? branchInput : undefined;

  let session: Session;
  try {
    session = await api.createSession({ repo, branch });
  } catch (err) {
    const msg = err instanceof ApiCallError ? err.message : "API unreachable";
    showError(msg);
    if (submitButton) submitButton.disabled = false;
    return;
  } finally {
    // Once we hand off to the polling state machine, the form is hidden
    // and the button doesn't matter; re-enable so a future return-to-idle
    // doesn't leave the form locked.
    if (submitButton) submitButton.disabled = false;
  }
  state.toCreating(session.sessionId);
  void pollUntilReady(session.sessionId);
});

$<HTMLButtonElement>("#stop-btn").addEventListener("click", async () => {
  const view = state.get();
  if (view.kind !== "ready") return;
  if (!confirm("Stop this session? Pending edits will be pushed to the feature branch and the pod terminated.")) {
    return;
  }
  // Re-check state — the synchronous confirm dialog blocks the event
  // loop, but a queued state-listener callback could have already run.
  const after = state.get();
  if (after.kind !== "ready") return;
  // Abort any in-flight pollUntilReady before transitioning so a late
  // getSession response can't promote the view back to "ready" after we
  // start stopping.
  activePoll?.abort();
  const { sessionId } = after.session;
  state.toStopping(sessionId);
  try {
    await api.deleteSession(sessionId);
  } catch (err) {
    if (!(err instanceof ApiCallError) || err.status !== 404) {
      const msg = err instanceof Error ? err.message : "Unable to stop";
      state.toIdle(`Stop failed: ${msg}`);
      return;
    }
  }
  void pollUntilGone(sessionId);
});

// Boot.
state.toIdle();
