import { describe, it, expect, vi } from "vitest";
import {
  GithubClientError,
  GithubRateLimited,
  GithubServerError,
  RepoNameCollision,
  createAppRepo,
  slugify,
  type GithubClient,
} from "../../src/lib/github.js";

function makeMockClient(
  createInOrg: GithubClient["rest"]["repos"]["createInOrg"],
): GithubClient {
  return { rest: { repos: { createInOrg } } };
}

function okResponse(name: string) {
  return {
    data: {
      name,
      html_url: `https://github.com/openvoid-platform/${name}`,
      clone_url: `https://github.com/openvoid-platform/${name}.git`,
    },
  };
}

describe("slugify", () => {
  it("kebab-cases a basic prompt and appends a 6-char suffix", () => {
    expect(slugify("AI flashcards")).toMatch(/^ai-flashcards-[a-z0-9]{6}$/);
  });

  it("falls back to `app` when the prompt is undefined", () => {
    expect(slugify(undefined)).toMatch(/^app-[a-z0-9]{6}$/);
  });

  it("falls back to `app` when the prompt is empty", () => {
    expect(slugify("")).toMatch(/^app-[a-z0-9]{6}$/);
  });

  it("falls back to `app` when sanitisation leaves an empty string", () => {
    expect(slugify("---")).toMatch(/^app-[a-z0-9]{6}$/);
    expect(slugify("!!!")).toMatch(/^app-[a-z0-9]{6}$/);
    expect(slugify("    ")).toMatch(/^app-[a-z0-9]{6}$/);
  });

  it("collapses runs of non-alphanumerics and strips leading/trailing dashes", () => {
    expect(slugify("$$$ super!!! cool")).toMatch(/^super-cool-[a-z0-9]{6}$/);
  });

  it("truncates the base at 40 chars before appending the suffix", () => {
    const slug = slugify("a".repeat(100));
    // 40 chars + dash + 6 = 47
    expect(slug).toHaveLength(47);
    expect(slug).toMatch(/^a{40}-[a-z0-9]{6}$/);
  });

  it("strips a trailing dash that the truncation introduces", () => {
    // 40-char window ending mid-non-alphanumeric should not produce
    // `<base>--<suffix>`.
    const slug = slugify("abc".repeat(20) + "@#"); // sanitises to abcabc...
    expect(slug).not.toContain("--");
    expect(slug.endsWith("-")).toBe(false);
  });

  it("strips (not transliterates) Unicode in v1", () => {
    expect(slugify("Café résumé")).toMatch(/^caf-r-sum-[a-z0-9]{6}$/);
  });

  it("uses an alphabet that excludes ambiguous characters", () => {
    // 200 slugs × 6 chars = 1200 suffix chars; assert none of the
    // ambiguous ones (i/l/o/0/1) show up. Random with a 24-char
    // alphabet — the probability of a collision is ~0 for ambiguous
    // chars (they're not in the alphabet at all).
    const banned = new Set(["i", "l", "o", "0", "1"]);
    for (let i = 0; i < 200; i += 1) {
      const suffix = slugify("x").split("-").pop()!;
      for (const ch of suffix) {
        expect(banned.has(ch), `slug suffix contains banned char "${ch}"`).toBe(false);
      }
    }
  });

  it("two concurrent calls with the same prompt produce different slugs (AE4)", () => {
    // Random suffix is generated per call, not per prompt.
    const slugs = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      slugs.add(slugify("widget tracker"));
    }
    // Allowing for vanishingly rare collisions, expect near-50 unique.
    expect(slugs.size).toBeGreaterThanOrEqual(48);
  });
});

describe("createAppRepo", () => {
  const baseName = "ai-flashcards-x7f2k9";

  it("calls octokit createInOrg with the right payload and returns mapped URLs", async () => {
    const createInOrg = vi.fn(async () => okResponse(baseName));
    const client = makeMockClient(createInOrg);

    const result = await createAppRepo(client, {
      org: "openvoid-platform",
      baseName,
      description: "openvoid app: AI flashcards",
    });

    expect(createInOrg).toHaveBeenCalledTimes(1);
    expect(createInOrg.mock.calls[0][0]).toEqual({
      org: "openvoid-platform",
      name: baseName,
      private: false,
      auto_init: false,
      description: "openvoid app: AI flashcards",
    });
    expect(result).toEqual({
      repoName: baseName,
      htmlUrl: `https://github.com/openvoid-platform/${baseName}`,
      cloneUrl: `https://github.com/openvoid-platform/${baseName}.git`,
    });
  });

  it("defaults description to `openvoid app` when omitted", async () => {
    const createInOrg = vi.fn(async () => okResponse(baseName));
    await createAppRepo(makeMockClient(createInOrg), {
      org: "openvoid-platform",
      baseName,
    });
    expect(createInOrg.mock.calls[0][0].description).toBe("openvoid app");
  });

  it("throws RepoNameCollision on 422 'name already exists'", async () => {
    const err = Object.assign(new Error("name already exists on this account"), {
      status: 422,
    });
    const createInOrg = vi.fn(async () => {
      throw err;
    });
    await expect(
      createAppRepo(makeMockClient(createInOrg), {
        org: "openvoid-platform",
        baseName,
      }),
    ).rejects.toMatchObject({
      name: "RepoNameCollision",
      attemptedName: baseName,
    });
  });

  it("throws RepoNameCollision on any 422 (covers `invalid name` family too)", async () => {
    const err = Object.assign(new Error("Validation failed: name is invalid"), {
      status: 422,
    });
    await expect(
      createAppRepo(makeMockClient(async () => {
        throw err;
      }), {
        org: "openvoid-platform",
        baseName,
      }),
    ).rejects.toBeInstanceOf(RepoNameCollision);
  });

  it("throws GithubRateLimited on 403 with x-ratelimit-remaining: 0", async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 60;
    const err = Object.assign(new Error("API rate limit exceeded"), {
      status: 403,
      response: {
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(resetEpoch),
        },
      },
    });
    try {
      await createAppRepo(makeMockClient(async () => {
        throw err;
      }), {
        org: "openvoid-platform",
        baseName,
      });
      throw new Error("should have thrown");
    } catch (caught) {
      expect(caught).toBeInstanceOf(GithubRateLimited);
      expect((caught as GithubRateLimited).resetAt?.getTime()).toBe(resetEpoch * 1000);
    }
  });

  it("treats 403 without `x-ratelimit-remaining: 0` as a generic client error", async () => {
    const err = Object.assign(new Error("Forbidden"), {
      status: 403,
      response: { headers: { "x-ratelimit-remaining": "4998" } },
    });
    await expect(
      createAppRepo(makeMockClient(async () => {
        throw err;
      }), { org: "openvoid-platform", baseName }),
    ).rejects.toBeInstanceOf(GithubClientError);
  });

  it("throws GithubClientError on other 4xx", async () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    try {
      await createAppRepo(makeMockClient(async () => {
        throw err;
      }), { org: "openvoid-platform", baseName });
      throw new Error("should have thrown");
    } catch (caught) {
      expect(caught).toBeInstanceOf(GithubClientError);
      expect((caught as GithubClientError).status).toBe(401);
    }
  });

  it("throws GithubServerError on 5xx", async () => {
    const err = Object.assign(new Error("internal server error"), { status: 503 });
    try {
      await createAppRepo(makeMockClient(async () => {
        throw err;
      }), { org: "openvoid-platform", baseName });
      throw new Error("should have thrown");
    } catch (caught) {
      expect(caught).toBeInstanceOf(GithubServerError);
      expect((caught as GithubServerError).status).toBe(503);
    }
  });

  it("throws GithubServerError on a network failure (no status)", async () => {
    const err = Object.assign(new Error("ECONNRESET"), {});
    await expect(
      createAppRepo(makeMockClient(async () => {
        throw err;
      }), { org: "openvoid-platform", baseName }),
    ).rejects.toBeInstanceOf(GithubServerError);
  });
});
