import { describe, expect, it } from "vitest";
import { bullets, clamp, enforceCharacterLimit, marketPrefix, marketUrl } from "../src/tools/helpers.js";
import { CHARACTER_LIMIT } from "../src/constants.js";
import { formatError, invalidArgument, notFound, UdayBookingError } from "../src/utils/errors.js";
import { redact, redactUrl } from "../src/utils/logger.js";
import { TtlCache } from "../src/utils/cache.js";

describe("market paths", () => {
  it("gives the international edition no prefix", () => {
    expect(marketPrefix("international")).toBe("");
    expect(marketUrl("international", "/pricing")).toBe("https://udaybooking.com/pricing");
  });

  it("prefixes a country edition with its code", () => {
    expect(marketUrl("in", "/pricing")).toBe("https://udaybooking.com/in/pricing");
    expect(marketUrl("gb", "/help")).toBe("https://udaybooking.com/gb/help");
  });
});

describe("clamp", () => {
  it("leaves text inside the budget untouched", () => {
    const result = clamp("short", 100);
    expect(result).toEqual({ text: "short", truncated: false, originalLength: 5 });
  });

  it("truncates with an explicit, actionable note", () => {
    const text = "x".repeat(500);
    const result = clamp(text, 100);
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(500);
    expect(result.text).toMatch(/Truncated: showing \d+ of 500 characters/);
    expect(result.text).toMatch(/Raise max_chars/);
  });

  it("prefers a line break when one falls late in the budget", () => {
    const text = `${"a".repeat(80)}\n${"b".repeat(200)}`;
    const result = clamp(text, 100);
    expect(result.text.startsWith("a".repeat(80))).toBe(true);
    expect(result.text).not.toContain("b");
  });
});

describe("enforceCharacterLimit", () => {
  it("passes through a response within the limit", () => {
    expect(enforceCharacterLimit("fine")).toBe("fine");
  });

  it("caps an oversized response and explains how to narrow the request", () => {
    const out = enforceCharacterLimit("y".repeat(CHARACTER_LIMIT + 5_000));
    expect(out.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(out).toMatch(/Response truncated at/);
    expect(out).toMatch(/Narrow the request/);
  });
});

describe("bullets", () => {
  it("renders provided pairs and skips empty ones", () => {
    expect(bullets([["A", "1"], ["B", undefined], ["C", ""], ["D", 4]])).toBe(
      "- **A**: 1\n- **D**: 4",
    );
  });
});

describe("error formatting", () => {
  it("includes the code, status, hint and retry guidance", () => {
    const error = new UdayBookingError("UPSTREAM_UNAVAILABLE", "Origin down.", {
      status: 503,
      hint: "Try again shortly.",
      retryable: true,
    });
    const text = formatError(error);
    expect(text).toContain("[UPSTREAM_UNAVAILABLE]");
    expect(text).toContain("HTTP status: 503");
    expect(text).toContain("Try again shortly.");
    expect(text).toMatch(/transient/);
  });

  it("formats a plain Error and a non-error value", () => {
    expect(formatError(new Error("boom"))).toBe("Error: boom");
    expect(formatError("odd")).toBe("Error: odd");
  });

  it("builds the common error kinds with their codes", () => {
    expect(invalidArgument("bad").code).toBe("INVALID_ARGUMENT");
    expect(notFound("missing").code).toBe("NOT_FOUND");
    expect(notFound("missing").status).toBe(404);
  });
});

describe("log redaction", () => {
  it("redacts sensitive keys", () => {
    const out = redact({ apiKey: "secret-value", token: "abc", safe: "visible" }) as Record<
      string,
      unknown
    >;
    expect(out.apiKey).toBe("***redacted***");
    expect(out.token).toBe("***redacted***");
    expect(out.safe).toBe("visible");
  });

  it("redacts credentials and sensitive query parameters in URLs", () => {
    expect(redactUrl("https://user:pw@udaybooking.com/x")).toContain("***:***@");
    expect(redactUrl("https://udaybooking.com/x?api_key=abc&page=2")).toContain("api_key=***");
    expect(redactUrl("https://udaybooking.com/x?api_key=abc&page=2")).toContain("page=2");
  });

  it("leaves a malformed URL alone rather than throwing", () => {
    expect(redactUrl("not a url")).toBe("not a url");
  });

  it("truncates very long strings and caps recursion", () => {
    const long = redact("z".repeat(900)) as string;
    expect(long).toMatch(/truncated/);

    let deep: unknown = "bottom";
    for (let i = 0; i < 8; i++) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain("depth-limit");
  });
});

describe("TtlCache", () => {
  it("stores and returns a value", () => {
    const cache = new TtlCache<string>(1_000, 10);
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
  });

  it("expires an entry after its TTL", async () => {
    const cache = new TtlCache<string>(10, 10);
    cache.set("k", "v");
    await new Promise((r) => setTimeout(r, 25));
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new TtlCache<string>(10_000, 2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a"); // refresh 'a' so 'b' becomes least recent
    cache.set("c", "3");

    expect(cache.get("a")).toBe("1");
    expect(cache.get("c")).toBe("3");
    expect(cache.get("b")).toBeUndefined();
  });

  it("stores nothing when caching is disabled", () => {
    const cache = new TtlCache<string>(0, 10);
    cache.set("k", "v");
    expect(cache.get("k")).toBeUndefined();
  });
});
