import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { sessionsRouter } from "./routes/sessions.js";
import { mountDocs } from "./lib/scalar.js";
import { makePodOps } from "./k8s/client.js";

const PORT = Number(process.env.PORT ?? 4000);

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

mountDocs(app);

app.route("/", sessionsRouter(makePodOps()));

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`session-api listening on :${port}`);
});
