import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { CoreV1Api } from "@kubernetes/client-node";
import { sessionsRouter } from "./routes/sessions.js";
import { mountDocs } from "./lib/scalar.js";
import { loadKubeConfig, makeSessionOps } from "./k8s/client.js";
import { loadPlatformGithub, PLATFORM_GITHUB_ORG_ENV } from "./lib/github.js";

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

  // The new-app entry point needs the platform GitHub PAT + org name to
  // call repos.createInOrg. Reading lazily would surface the failure on
  // every new-app POST rather than at boot; fail-fast keeps the
  // operator's runbook step (see docs/runbooks/platform-github-org-setup.md)
  // diagnosable from the Deployment's CrashLoopBackOff. When the env
  // is unset we skip the Secret read entirely — operators running
  // import-repo-only deployments shouldn't be forced to provision the
  // platform creds.
  let newAppContext: { org: string; github: Awaited<ReturnType<typeof loadPlatformGithub>>["client"] } | undefined;
  if (process.env[PLATFORM_GITHUB_ORG_ENV]) {
    const kc = loadKubeConfig();
    const core = kc.makeApiClient(CoreV1Api);
    const { org, client } = await loadPlatformGithub(core);
    console.log(`loaded github-platform-creds for org ${org}`);
    newAppContext = { org, github: client };
  } else {
    console.warn(
      `${PLATFORM_GITHUB_ORG_ENV} unset; the new-app entry point will surface 501 until it is configured ` +
        `(see docs/runbooks/platform-github-org-setup.md).`,
    );
  }

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

  app.route("/", sessionsRouter({ sessionOps, newAppContext }));

  serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
    console.log(`session-api listening on :${port}`);
    console.log(`CORS allowed origin: ${landingOrigin()}`);
  });
}

main().catch((err) => {
  console.error("session-api failed to start:", err);
  process.exit(1);
});
