import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { sessionsRouter } from "./routes/sessions.js";
import { mountDocs } from "./lib/scalar.js";
import { makeSessionOps } from "./k8s/client.js";

const PORT = Number(process.env.PORT ?? 4000);

async function main(): Promise<void> {
  // makeSessionOps reads the opencode-server-password Secret; failure
  // here is fatal — the per-session Ingress can't inject Authorization
  // headers without it, and shipping a half-broken API would surface as
  // a confusing OpenCode password prompt at first session create.
  const sessionOps = await makeSessionOps();

  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  mountDocs(app);

  app.route("/", sessionsRouter(sessionOps));

  serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
    console.log(`session-api listening on :${port}`);
  });
}

main().catch((err) => {
  console.error("session-api failed to start:", err);
  process.exit(1);
});
