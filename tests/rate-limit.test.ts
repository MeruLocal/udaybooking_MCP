import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/services/rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to the limit in a window, then refuses with Retry-After", () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("a", 1).allowed).toBe(true);
    expect(rl.check("a", 2).allowed).toBe(true);
    const refused = rl.check("a", 10_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBe(50);
  });

  it("resets when the window ends", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1_000 });
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("a", 500).allowed).toBe(false);
    expect(rl.check("a", 1_000).allowed).toBe(true);
  });

  it("keeps separate buckets per key", () => {
    const rl = new RateLimiter({ limit: 1 });
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("b", 0).allowed).toBe(true);
    expect(rl.check("a", 0).allowed).toBe(false);
  });

  it("is disabled by a limit of 0", () => {
    const rl = new RateLimiter({ limit: 0 });
    for (let i = 0; i < 1_000; i++) expect(rl.check("a", i).allowed).toBe(true);
    expect(rl.size).toBe(0);
  });

  it("bounds the number of tracked keys, pruning expired then oldest", () => {
    const rl = new RateLimiter({ limit: 5, windowMs: 1_000, maxKeys: 3 });
    rl.check("k1", 0);
    rl.check("k2", 0);
    rl.check("k3", 500);
    rl.check("k4", 1_200); // k1 and k2 expired → pruned
    expect(rl.size).toBe(2);
    rl.check("k5", 1_300);
    rl.check("k6", 1_400); // full, nothing expired → oldest (k3) dropped
    expect(rl.size).toBe(3);
  });
});
