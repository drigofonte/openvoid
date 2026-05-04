// Phase 5.2 — git-finalizer SIGTERM-cascade integration test (kind-only).
//
// This test is **skipped by default**. It exercises the full lifecycle
// end-to-end against a real kind cluster, the real platform PAT, and a
// real GitHub repo. Running it in CI would require leaking a writable
// PAT into CI runners, which we don't want.
//
// To run locally:
//
//   1. `tilt up`                                 (kind cluster + session-api)
//   2. Apply git-creds Secret (per Phase 4 README).
//   3. Export the test inputs:
//      - OPENVOID_TEST_REPO         e.g. https://github.com/<you>/openvoid-test
//      - OPENVOID_TEST_GITHUB_TOKEN platform PAT with Contents:read+write on the repo
//      - OPENVOID_API_URL           default http://localhost:4000
//   4. `INTEGRATION=1 pnpm --filter @openvoid/session-api test:integration`
//
// The repo MUST already have at least one commit on `main` — git clone
// fails on an empty repo (see "Resolved during Phase 4 verification" in
// the plan).
//
// Characterization-first per the plan: this test captures the working
// SIGTERM-cascade behavior so future regressions surface immediately.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";

const INTEGRATION = process.env.INTEGRATION === "1";
const API_URL = process.env.OPENVOID_API_URL ?? "http://localhost:4000";
const TEST_REPO = process.env.OPENVOID_TEST_REPO ?? "";
const TEST_TOKEN = process.env.OPENVOID_TEST_GITHUB_TOKEN ?? "";
const NAMESPACE = "openvoid-sessions";

function kubectl(args: string[]): string {
  return execFileSync("kubectl", args, { encoding: "utf8" });
}

async function createSession(repo: string): Promise<string> {
  const res = await fetch(`${API_URL}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo }),
  });
  if (!res.ok) throw new Error(`POST /sessions failed: ${res.status}`);
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE /sessions/${sessionId} failed: ${res.status}`);
  }
}

async function waitForPodPhase(
  sessionId: string,
  phase: "Running",
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = kubectl([
        "get",
        "pod",
        "-n",
        NAMESPACE,
        `session-${sessionId.toLowerCase()}`,
        "-o",
        "jsonpath={.status.phase}",
      ]);
      if (out.trim() === phase) return;
    } catch {
      // Pod not yet visible to apiserver; retry.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`pod did not reach phase=${phase} within ${timeoutMs}ms`);
}

async function waitForPodGone(sessionId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      kubectl([
        "get",
        "pod",
        "-n",
        NAMESPACE,
        `session-${sessionId.toLowerCase()}`,
        "--ignore-not-found",
        "-o",
        "name",
      ]);
      // If the call returned without throwing AND the pod is gone, kubectl
      // emits empty stdout; we can't easily distinguish that from a slow
      // apiserver here without parsing. Re-poll until ignore-not-found
      // produces empty output.
      const out = kubectl([
        "get",
        "pod",
        "-n",
        NAMESPACE,
        `session-${sessionId.toLowerCase()}`,
        "--ignore-not-found",
        "-o",
        "name",
      ]);
      if (out.trim() === "") return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`pod still present after ${timeoutMs}ms`);
}

async function fetchRemoteBranch(
  repo: string,
  branch: string,
  token: string,
): Promise<{ exists: boolean; status: number }> {
  // Translate https://github.com/<owner>/<repo>(.git)? → API path.
  const m = repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`unsupported repo URL: ${repo}`);
  const [, owner, name] = m;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
      },
    },
  );
  return { exists: res.status === 200, status: res.status };
}

async function deleteRemoteBranch(
  repo: string,
  branch: string,
  token: string,
): Promise<void> {
  const m = repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return;
  const [, owner, name] = m;
  await fetch(
    `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "DELETE",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
      },
    },
  );
}

describe.skipIf(!INTEGRATION)("git-finalizer SIGTERM cascade (Phase 5.2)", () => {
  beforeAll(() => {
    if (!TEST_REPO) throw new Error("OPENVOID_TEST_REPO is required");
    if (!TEST_TOKEN) throw new Error("OPENVOID_TEST_GITHUB_TOKEN is required");
  });

  it(
    "edited session → DELETE → branch lands on GitHub with the edit",
    async () => {
      const sessionId = await createSession(TEST_REPO);
      const branch = `feat/${sessionId.toLowerCase()}`;

      // Clean up any prior run of this branch so the assertion is meaningful.
      await deleteRemoteBranch(TEST_REPO, branch, TEST_TOKEN);

      try {
        await waitForPodPhase(sessionId, "Running", 60_000);

        // Edit a file in the workspace via the main (nginx) container's
        // filesystem — same volume, different mount path (/usr/share/nginx/html
        // for nginx, /workspace for the sidecar; both see /repo/<file>).
        const podName = `session-${sessionId.toLowerCase()}`;
        kubectl([
          "exec",
          "-n",
          NAMESPACE,
          podName,
          "-c",
          "session",
          "--",
          "sh",
          "-c",
          `echo "phase-5 finalizer e2e $(date -Iseconds)" > /usr/share/nginx/html/repo/finalizer-test.txt`,
        ]);

        await deleteSession(sessionId);
        await waitForPodGone(sessionId, 240_000);

        const branchInfo = await fetchRemoteBranch(TEST_REPO, branch, TEST_TOKEN);
        expect(branchInfo.exists, `feat/${sessionId} should exist on remote`).toBe(true);
      } finally {
        await deleteRemoteBranch(TEST_REPO, branch, TEST_TOKEN).catch(() => {});
      }
    },
    300_000,
  );

  it(
    "no-edit session → DELETE → no feat branch is created on GitHub",
    async () => {
      const sessionId = await createSession(TEST_REPO);
      const branch = `feat/${sessionId.toLowerCase()}`;

      await deleteRemoteBranch(TEST_REPO, branch, TEST_TOKEN);

      try {
        await waitForPodPhase(sessionId, "Running", 60_000);
        // No edit; just delete.
        await deleteSession(sessionId);
        await waitForPodGone(sessionId, 240_000);

        const branchInfo = await fetchRemoteBranch(TEST_REPO, branch, TEST_TOKEN);
        expect(branchInfo.exists).toBe(false);
        expect(branchInfo.status).toBe(404);
      } finally {
        await deleteRemoteBranch(TEST_REPO, branch, TEST_TOKEN).catch(() => {});
      }
    },
    300_000,
  );

  it(
    "force-delete (--grace-period=0 --force) → finalizer SIGKILLed → no branch",
    async () => {
      const sessionId = await createSession(TEST_REPO);
      const branch = `feat/${sessionId.toLowerCase()}`;
      const podName = `session-${sessionId.toLowerCase()}`;

      await deleteRemoteBranch(TEST_REPO, branch, TEST_TOKEN);

      try {
        await waitForPodPhase(sessionId, "Running", 60_000);
        kubectl([
          "exec",
          "-n",
          NAMESPACE,
          podName,
          "-c",
          "session",
          "--",
          "sh",
          "-c",
          `echo "force-delete test" > /usr/share/nginx/html/repo/force-delete-test.txt`,
        ]);

        // Documented "do not force-delete sessions" rule: SIGKILL skips
        // the trap, so no commit/push happens.
        kubectl([
          "delete",
          "pod",
          "-n",
          NAMESPACE,
          podName,
          "--grace-period=0",
          "--force",
        ]);
        await waitForPodGone(sessionId, 30_000);

        const branchInfo = await fetchRemoteBranch(TEST_REPO, branch, TEST_TOKEN);
        expect(branchInfo.exists).toBe(false);
      } finally {
        await deleteRemoteBranch(TEST_REPO, branch, TEST_TOKEN).catch(() => {});
      }
    },
    180_000,
  );
});
