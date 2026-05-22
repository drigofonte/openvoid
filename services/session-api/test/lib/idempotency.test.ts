import { describe, it, expect } from "vitest";
import { IdempotencyCache } from "../../src/lib/idempotency.js";

type Value = { sessionId: string };
type Err = { code: string };

function makeCache(opts: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
  return new IdempotencyCache<Value, Err>(opts);
}

describe("IdempotencyCache", () => {
  it("returns `fresh: true` on the first reserve and `fresh: false` on a duplicate", () => {
    const cache = makeCache();
    const a = cache.reserve("k");
    const b = cache.reserve("k");
    expect(a).toEqual({ fresh: true });
    expect(b).toMatchObject({ fresh: false });
    if (!b.fresh) expect(b.prior).toEqual({ kind: "in-flight" });
  });

  it("surfaces a completed result on subsequent reserve", () => {
    const cache = makeCache();
    cache.reserve("k");
    cache.complete("k", { sessionId: "s1" });
    const r = cache.reserve("k");
    expect(r.fresh).toBe(false);
    if (!r.fresh) expect(r.prior).toEqual({ kind: "completed", value: { sessionId: "s1" } });
  });

  it("surfaces a failed result on subsequent reserve", () => {
    const cache = makeCache();
    cache.reserve("k");
    cache.fail("k", { code: "github_rate_limited" });
    const r = cache.reserve("k");
    expect(r.fresh).toBe(false);
    if (!r.fresh) expect(r.prior).toEqual({ kind: "failed", error: { code: "github_rate_limited" } });
  });

  it("forget() drops an in-flight reservation so a retry behaves freshly", () => {
    const cache = makeCache();
    cache.reserve("k");
    cache.forget("k");
    expect(cache.reserve("k")).toEqual({ fresh: true });
  });

  it("expires entries past TTL", () => {
    let now = 1_000_000;
    const cache = makeCache({ ttlMs: 60_000, now: () => now });
    cache.reserve("k");
    cache.complete("k", { sessionId: "s1" });
    now += 30_000;
    const within = cache.get("k");
    expect(within).toEqual({ kind: "completed", value: { sessionId: "s1" } });

    now += 31_000; // past 60s TTL
    expect(cache.get("k")).toBeUndefined();
    // Reserve after expiry behaves like fresh.
    expect(cache.reserve("k")).toEqual({ fresh: true });
  });

  it("respects maxEntries by evicting expired entries first", () => {
    let now = 1_000_000;
    const cache = makeCache({ ttlMs: 60_000, maxEntries: 3, now: () => now });

    cache.reserve("a");
    cache.reserve("b");
    cache.reserve("c");
    expect(cache.size()).toBe(3);

    // Advance past TTL on a and b only.
    now += 61_000;
    // Inserting d should expire a + b first, leaving space.
    cache.reserve("d");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    // c is also expired by the same advance — get() expires it lazily.
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("d")).toEqual({ kind: "in-flight" });
  });

  it("falls back to FIFO eviction when nothing has expired and the cache is full", () => {
    let now = 1_000_000;
    const cache = makeCache({ ttlMs: 60_000, maxEntries: 2, now: () => now });

    cache.reserve("a");
    cache.reserve("b");
    // Both still in TTL; inserting `c` must drop one. FIFO -> drops `a`.
    cache.reserve("c");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toEqual({ kind: "in-flight" });
    expect(cache.get("c")).toEqual({ kind: "in-flight" });
  });

  it("get() does not refresh TTL", () => {
    let now = 1_000_000;
    const cache = makeCache({ ttlMs: 60_000, now: () => now });
    cache.reserve("k");
    now += 30_000;
    cache.get("k"); // peek — no refresh
    now += 31_000;
    expect(cache.get("k")).toBeUndefined();
  });
});
