// TTL-bounded in-memory idempotency cache keyed on `Idempotency-Key`.
//
// v1 sizing: 5-minute TTL, 1000-entry hard cap. Enough to dedupe a
// retried form submit (the only realistic concurrency source) and far
// short of memory pressure on the Deployment's 256Mi limit. Single-
// replica only — the v1 manifest pins replicas: 1 and the
// platform-github-org runbook documents not scaling without a
// distributed store (Redis is the obvious next shape; v1.5 territory).
//
// Entries flow `in-flight` → `completed` (or `failed`). Concurrent
// retries while `in-flight` get back a `pending` marker so the caller
// can decide between waiting and rejecting; today the route handler
// rejects with 409 to keep behavior deterministic.

export type IdempotencyResult<T, E> =
  | { kind: "in-flight" }
  | { kind: "completed"; value: T }
  | { kind: "failed"; error: E };

type Entry<T, E> = IdempotencyResult<T, E> & { expiresAt: number };

export type IdempotencyCacheOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

export class IdempotencyCache<T, E> {
  private readonly entries = new Map<string, Entry<T, E>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: IdempotencyCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Reserve a key as `in-flight`. Returns either the freshly reserved
   * marker (caller proceeds) or whatever the cache already holds
   * (caller short-circuits with the prior result, or rejects on
   * `in-flight`). The reservation is opportunistic — there's no
   * locking; concurrent reserves race and the first writer wins.
   */
  reserve(key: string): { fresh: true } | { fresh: false; prior: IdempotencyResult<T, E> } {
    const existing = this.get(key);
    if (existing) return { fresh: false, prior: existing };
    this.evictIfFull();
    this.entries.set(key, { kind: "in-flight", expiresAt: this.now() + this.ttlMs });
    return { fresh: true };
  }

  complete(key: string, value: T): void {
    this.entries.set(key, { kind: "completed", value, expiresAt: this.now() + this.ttlMs });
  }

  fail(key: string, error: E): void {
    this.entries.set(key, { kind: "failed", error, expiresAt: this.now() + this.ttlMs });
  }

  /** Remove a key — useful when an `in-flight` reservation should be
   * undone (e.g. the caller decided not to proceed after all). */
  forget(key: string): void {
    this.entries.delete(key);
  }

  get(key: string): IdempotencyResult<T, E> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Strip expiresAt before exposing.
    if (entry.kind === "in-flight") return { kind: "in-flight" };
    if (entry.kind === "completed") return { kind: "completed", value: entry.value };
    return { kind: "failed", error: entry.error };
  }

  size(): number {
    return this.entries.size;
  }

  private evictIfFull(): void {
    if (this.entries.size < this.maxEntries) return;
    // First pass: drop anything past its TTL — cheap, common case.
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    if (this.entries.size < this.maxEntries) return;
    // Still full — drop the oldest entry (Map iteration order is
    // insertion order). FIFO eviction; entries don't refresh on read,
    // so insertion age == idle age.
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) this.entries.delete(oldest);
  }
}
