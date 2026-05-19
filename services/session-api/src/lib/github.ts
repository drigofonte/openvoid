import { Octokit } from "@octokit/rest";
import type { CoreV1Api } from "@kubernetes/client-node";

// Secret + env wiring for the platform org PAT. The Secret lives in the
// session namespace (where workspace-init / git-finalizer consume it as
// well); session-api reads it once at boot via the in-cluster K8s API
// because Kubernetes does not support cross-namespace `secretKeyRef`.
// See docs/runbooks/platform-github-org-setup.md for operator setup.
export const PLATFORM_GITHUB_CREDS_SECRET_NAME = "github-platform-creds";
export const PLATFORM_GITHUB_CREDS_SECRET_KEY = "token";
export const PLATFORM_GITHUB_ORG_ENV = "OPENVOID_PLATFORM_GITHUB_ORG";
export const PLATFORM_GITHUB_CREDS_NAMESPACE = "openvoid-sessions";

// 6 alphanumeric chars excluding visually ambiguous ones (i, l, o, 0,
// 1). Enough entropy (24^6 ≈ 191M) that collisions in any realistic
// concurrent-request volume are vanishingly rare; the route handler
// retries up to 3 times on `RepoNameCollision` before giving up.
const SLUG_SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SLUG_SUFFIX_LENGTH = 6;
const SLUG_BASE_MAX_LENGTH = 40;

/**
 * Build a kebab-cased, GitHub-repo-name-safe slug from a free-form
 * prompt, with a random suffix to guarantee uniqueness without a
 * collision-retry loop on the helper itself.
 *
 * The base is the prompt lowercased, non-alphanumeric runs collapsed to
 * `-`, leading/trailing dashes stripped, truncated to 40 chars. If
 * stripping leaves an empty base (e.g. emoji-only or punctuation-only
 * prompt), `app` is the fallback. The suffix is 6 chars from a
 * 24-character alphabet (numbers + lowercase letters, ambiguous
 * characters removed).
 *
 * Unicode is stripped, not transliterated, in v1 — `"Café résumé"`
 * becomes `"caf-r-sum"`, not `"cafe-resume"`. Transliteration would add
 * a dep without solving a real user problem (the slug is internal to
 * the platform; the agent renames things as it builds).
 */
export function slugify(prompt?: string): string {
  const base = sanitizeBase(prompt ?? "");
  const truncated = base.slice(0, SLUG_BASE_MAX_LENGTH).replace(/-+$/, "");
  const root = truncated.length > 0 ? truncated : "app";
  return `${root}-${randomSuffix()}`;
}

function sanitizeBase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function randomSuffix(): string {
  let out = "";
  for (let i = 0; i < SLUG_SUFFIX_LENGTH; i += 1) {
    out += SLUG_SUFFIX_ALPHABET[Math.floor(Math.random() * SLUG_SUFFIX_ALPHABET.length)];
  }
  return out;
}

export class GithubClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GithubClientError";
  }
}

export class GithubServerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GithubServerError";
  }
}

export class GithubRateLimited extends Error {
  constructor(
    message: string,
    public readonly resetAt?: Date,
  ) {
    super(message);
    this.name = "GithubRateLimited";
  }
}

export class RepoNameCollision extends Error {
  constructor(public readonly attemptedName: string) {
    super(`GitHub rejected repo name "${attemptedName}" as already in use`);
    this.name = "RepoNameCollision";
  }
}

export type CreateAppRepoArgs = {
  org: string;
  baseName: string;
  description?: string;
};

export type CreateAppRepoResult = {
  repoName: string;
  htmlUrl: string;
  cloneUrl: string;
};

export type GithubClient = {
  rest: {
    repos: {
      createInOrg: (params: {
        org: string;
        name: string;
        private?: boolean;
        auto_init?: boolean;
        description?: string;
      }) => Promise<{
        data: {
          name: string;
          html_url: string;
          clone_url: string;
        };
      }>;
    };
  };
};

/**
 * Create a public repo under the platform org. Returns the canonical
 * URLs needed downstream by workspace-init's seed flow.
 *
 * Error mapping is deliberately granular so the route handler can pick
 * the right HTTP response: collisions retry, rate limits surface as
 * 503 + Retry-After, client errors as 4xx, server errors as 5xx.
 */
export async function createAppRepo(
  client: GithubClient,
  { org, baseName, description }: CreateAppRepoArgs,
): Promise<CreateAppRepoResult> {
  try {
    const { data } = await client.rest.repos.createInOrg({
      org,
      name: baseName,
      private: false,
      auto_init: false,
      description: description ?? `openvoid app`,
    });
    return {
      repoName: data.name,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
    };
  } catch (err) {
    throw mapOctokitError(err, baseName);
  }
}

function mapOctokitError(err: unknown, attemptedName: string): Error {
  if (!err || typeof err !== "object") {
    return new GithubServerError(errorMessage(err));
  }
  const e = err as {
    status?: number;
    message?: string;
    response?: { headers?: Record<string, string | undefined> };
  };
  const status = typeof e.status === "number" ? e.status : undefined;

  if (status === 422 && /already exists|name already exists/i.test(e.message ?? "")) {
    return new RepoNameCollision(attemptedName);
  }
  if (status === 422) {
    // 422 also covers "name contains invalid characters". Treat the
    // non-"already exists" cases as collisions too — the caller's
    // retry policy will pick a fresh slug, which sidesteps the issue.
    return new RepoNameCollision(attemptedName);
  }

  const headers = e.response?.headers ?? {};
  const remainingHeader = headers["x-ratelimit-remaining"];
  const remaining = remainingHeader !== undefined ? Number(remainingHeader) : NaN;
  if (status === 403 && Number.isFinite(remaining) && remaining === 0) {
    const resetHeader = headers["x-ratelimit-reset"];
    const resetEpoch = resetHeader !== undefined ? Number(resetHeader) : NaN;
    const resetAt = Number.isFinite(resetEpoch) ? new Date(resetEpoch * 1000) : undefined;
    return new GithubRateLimited(e.message ?? "GitHub rate limit exhausted", resetAt);
  }

  if (typeof status === "number" && status >= 400 && status < 500) {
    return new GithubClientError(e.message ?? `GitHub ${status}`, status);
  }
  if (typeof status === "number" && status >= 500) {
    return new GithubServerError(e.message ?? `GitHub ${status}`, status);
  }
  // Network failure — octokit surfaces those without a numeric status.
  return new GithubServerError(e.message ?? "GitHub request failed");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "GitHub request failed";
}

/**
 * Boot-time read of the github-platform-creds Secret + the
 * OPENVOID_PLATFORM_GITHUB_ORG env. Both are required when the
 * new-app entry point is in use; absence is fatal at boot so the
 * Deployment surfaces a clear failure (mirrors `loadOpencodeAuthHeader`).
 */
export async function loadPlatformGithub(
  api: CoreV1Api,
): Promise<{ org: string; client: GithubClient }> {
  const org = process.env[PLATFORM_GITHUB_ORG_ENV];
  if (!org || org.length === 0) {
    throw new Error(
      `${PLATFORM_GITHUB_ORG_ENV} env var is unset; cannot create per-app repos. ` +
        `See docs/runbooks/platform-github-org-setup.md.`,
    );
  }

  let secret;
  try {
    secret = await api.readNamespacedSecret({
      name: PLATFORM_GITHUB_CREDS_SECRET_NAME,
      namespace: PLATFORM_GITHUB_CREDS_NAMESPACE,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot read Secret ${PLATFORM_GITHUB_CREDS_NAMESPACE}/${PLATFORM_GITHUB_CREDS_SECRET_NAME} ` +
        `(required for the new-app entry point): ${reason}`,
    );
  }

  const tokenB64 = secret.data?.[PLATFORM_GITHUB_CREDS_SECRET_KEY];
  if (tokenB64 === undefined) {
    throw new Error(
      `Secret ${PLATFORM_GITHUB_CREDS_NAMESPACE}/${PLATFORM_GITHUB_CREDS_SECRET_NAME} ` +
        `is missing key "${PLATFORM_GITHUB_CREDS_SECRET_KEY}".`,
    );
  }
  const token = Buffer.from(tokenB64, "base64").toString("utf8");
  if (token.length === 0) {
    throw new Error(
      `Secret ${PLATFORM_GITHUB_CREDS_NAMESPACE}/${PLATFORM_GITHUB_CREDS_SECRET_NAME}.${PLATFORM_GITHUB_CREDS_SECRET_KEY} ` +
        `decoded to an empty string.`,
    );
  }

  const client = new Octokit({ auth: token }) as unknown as GithubClient;
  return { org, client };
}
