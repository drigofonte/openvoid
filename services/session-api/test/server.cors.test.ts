// Phase 7.3 — CORS smoke test. The actual middleware lives in
// server.ts; we replicate the wiring here so the test can verify
// preflight behavior without standing up the K8s client. The intent:
// requests from the configured landing origin pass; other origins do
// not get the permissive headers (browser will block).

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";

function makeApp(allowedOrigin: string) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: allowedOrigin,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      credentials: false,
    }),
  );
  app.post("/sessions", (c) => c.json({ sessionId: "x", status: "Pending" }, 201));
  app.get("/sessions/:id", (c) => c.json({ sessionId: "x", status: "Running" }, 200));
  return app;
}

describe("CORS middleware (Unit 7.3)", () => {
  const ALLOWED = "http://app.127.0.0.1.nip.io";

  it("preflight from the allowed origin returns CORS headers covering POST + DELETE", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/sessions", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    const methods = res.headers.get("access-control-allow-methods") ?? "";
    expect(methods).toContain("POST");
    expect(methods).toContain("DELETE");
  });

  it("a real POST from the allowed origin echoes Access-Control-Allow-Origin", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { Origin: ALLOWED, "content-type": "application/json" },
      body: JSON.stringify({ repo: "https://github.com/example/x" }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  });

  it("a request from a different origin does NOT receive CORS allow-origin (browser will block)", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/sessions/01HABCDEF", {
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe(
      "https://evil.example.com",
    );
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("does not enable credentials (the API is stateless, no cookies)", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/sessions/01HABCDEF", {
      headers: { Origin: ALLOWED },
    });
    // hono/cors only emits Access-Control-Allow-Credentials when
    // credentials:true. Absence is the assertion.
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
