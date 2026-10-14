import { describe, expect, it, vi } from "vitest";
import { SessionRegistry, type SessionLike } from "../src/services/session-registry.js";

/** A session stub that records whether it was closed. */
function stub(): SessionLike & { closed: boolean } {
  const s = {
    closed: false,
    async close() {
      s.closed = true;
    },
  };
  return s;
}

/** A registry driven by a clock the test controls. */
function registry(idleTtlMs = 1_000) {
  let now = 10_000;
  const reg = new SessionRegistry<SessionLike & { closed: boolean }>({
    idleTtlMs,
    now: () => now,
  });
  return { reg, advance: (ms: number) => (now += ms) };
}

describe("SessionRegistry", () => {
  it("stores and retrieves a session", () => {
    const { reg } = registry();
    const s = stub();
    reg.add("a", s);

    expect(reg.size).toBe(1);
    expect(reg.has("a")).toBe(true);
    expect(reg.touch("a")).toBe(s);
    expect(reg.peek("a")).toBe(s);
  });

  it("returns undefined for an unknown id", () => {
    const { reg } = registry();
    expect(reg.touch("missing")).toBeUndefined();
    expect(reg.peek("missing")).toBeUndefined();
    expect(reg.has("missing")).toBe(false);
  });

  it("reaps a session that has been idle beyond the TTL", async () => {
    const { reg, advance } = registry(1_000);
    const s = stub();
    reg.add("a", s);

    advance(1_500);
    expect(reg.idleIds()).toEqual(["a"]);

    const reaped = await reg.reapIdle();
    expect(reaped).toEqual(["a"]);
    expect(reg.size).toBe(0);
    expect(s.closed).toBe(true);
  });

  it("keeps a session that is still within the TTL", async () => {
    const { reg, advance } = registry(1_000);
    reg.add("a", stub());

    advance(500);
    expect(await reg.reapIdle()).toEqual([]);
    expect(reg.size).toBe(1);
  });

  it("touch resets the idle timer, so an active session is never reaped", async () => {
    const { reg, advance } = registry(1_000);
    const s = stub();
    reg.add("a", s);

    // Three quiet-but-active periods, each shorter than the TTL.
    for (let i = 0; i < 3; i++) {
      advance(800);
      reg.touch("a");
    }

    expect(await reg.reapIdle()).toEqual([]);
    expect(s.closed).toBe(false);

    // Now go quiet for longer than the TTL.
    advance(1_200);
    expect(await reg.reapIdle()).toEqual(["a"]);
    expect(s.closed).toBe(true);
  });

  it("peek does not reset the idle timer", async () => {
    const { reg, advance } = registry(1_000);
    reg.add("a", stub());

    advance(1_500);
    reg.peek("a");

    expect(await reg.reapIdle()).toEqual(["a"]);
  });

  it("reaps only the idle sessions, leaving active ones alone", async () => {
    const { reg, advance } = registry(1_000);
    const idle = stub();
    const active = stub();
    reg.add("idle", idle);
    reg.add("active", active);

    advance(1_500);
    reg.touch("active");

    expect(await reg.reapIdle()).toEqual(["idle"]);
    expect(reg.size).toBe(1);
    expect(idle.closed).toBe(true);
    expect(active.closed).toBe(false);
  });

  it("forget removes an entry without closing it", () => {
    const { reg } = registry();
    const s = stub();
    reg.add("a", s);

    expect(reg.forget("a")).toBe(true);
    expect(reg.size).toBe(0);
    expect(s.closed).toBe(false);
    expect(reg.forget("a")).toBe(false);
  });

  it("drops a session even when closing it throws", async () => {
    const { reg, advance } = registry(1_000);
    reg.add("bad", {
      closed: false,
      close: vi.fn().mockRejectedValue(new Error("transport already gone")),
    } as unknown as SessionLike & { closed: boolean });

    advance(1_500);
    await expect(reg.reapIdle()).resolves.toEqual(["bad"]);
    // The point of reaping is to stop holding the entry, so it must go.
    expect(reg.size).toBe(0);
  });

  it("closeAll closes every session and empties the registry", async () => {
    const { reg } = registry();
    const a = stub();
    const b = stub();
    reg.add("a", a);
    reg.add("b", b);

    await reg.closeAll();

    expect(reg.size).toBe(0);
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
  });

  it("re-adding an id replaces the entry and resets its timer", async () => {
    const { reg, advance } = registry(1_000);
    reg.add("a", stub());
    advance(1_500);

    const replacement = stub();
    reg.add("a", replacement);

    expect(await reg.reapIdle()).toEqual([]);
    expect(reg.peek("a")).toBe(replacement);
  });
});
