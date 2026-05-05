import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionsRouter } from "./routes/sessions.js";
import { mountDocs } from "./lib/scalar.js";
import { makeSessionOps } from "./k8s/client.js";

const PORT = Number(process.env.PORT ?? 4000);

// The browser-facing landing page hostname. CORS is the only protection
// between the public landing page and the API in v1; the threat model
// already accepts session-ID-as-credential, and the API surface is
// small (3 endpoints, no admin). DOKS overrides via env in Phase 8.
const DEFAULT_LANDING_ORIGIN = "http://app.127.0.0.1.nip.io";

function landingOrigin(): string {
  const v = process.env.OPENVOID_LANDING_ORIGIN;
  return v && v.length > 0 ? v : DEFAULT_LANDING_ORIGIN;
}

async function main(): Promise<void> {
  // makeSessionOps reads the opencode-server-password Secret; failure
  // here is fatal — the per-session Ingress can't inject Authorization
  // headers without it, and shipping a half-broken API would surface as
  // a confusing OpenCode password prompt at first session create.
  const sessionOps = await makeSessionOps();

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: landingOrigin(),
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      // No cookies — the API is stateless. The session ID itself is the
      // only thing the browser holds, and the landing page passes it as
      // a path parameter (not a credential header).
      credentials: false,
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  mountDocs(app);

  app.route("/", sessionsRouter(sessionOps));

  serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
    console.log(`session-api listening on :${port}`);
    console.log(`CORS allowed origin: ${landingOrigin()}`);
  });
}

main().catch((err) => {
  console.error("session-api failed to start:", err);
  process.exit(1);
});
