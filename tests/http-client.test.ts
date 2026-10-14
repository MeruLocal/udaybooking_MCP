import { afterEach, describe, expect, it } from "vitest";
import { HttpClient } from "../src/services/http-client.js";
import { loadConfig, type Config } from "../src/config.js";
import { createLogger } from "../src/utils/logger.js";
import { UdayBookingError } from "../src/utils/errors.js";
import { mockFetch, type MockHandle } from "./mock-fetch.js";

let handle: MockHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
});

function client(overrides: Partial<Config> = {}): HttpClient {
  const config: Config = {
    ...loadConfig({}),
    // Keep the suite fast: no politeness delay, short timeouts, quiet logs.
    minRequestIntervalMs: 0,
    retryBaseDelayMs: 1,
    requestTimeoutMs: 80,
    logLevel: "silent",
    ...overrides,
  };
  return new HttpClient(config, createLogger(config));
}

describe("HttpClient — robots.txt compliance", () => {
  it("refuses any path under /api/, which robots.txt disallows for all agents", () => {
    const http = client();
    for (const path of ["/api/", "/api/v1/bookings", "/api/availability?x=1"]) {
      expect(() => http.resolveUrl(path)).toThrowError(/robots\.txt disallows/i);
    }
  });

  it("reports DISALLOWED_PATH with guidance toward the content tools", () => {
    try {
      client().resolveUrl("/api/v1/bookings");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UdayBookingError);
      const e = error as UdayBookingError;
      expect(e.code).toBe("DISALLOWED_PATH");
      expect(e.hint).toMatch(/udaybooking_search_content/);
    }
  });

  it("allows paths that merely contain 'api' elsewhere", () => {
    expect(client().resolveUrl("/in/docs/rapid-api-guide")).toContain("/in/docs/rapid-api-guide");
  });
});

describe("HttpClient — host pinning", () => {
  it("refuses hosts other than udaybooking.com", () => {
    const http = client();
    for (const url of ["https://example.com/", "https://evil.test/x", "http://localhost:8080/"]) {
      expect(() => http.resolveUrl(url)).toThrowError(/only reads udaybooking\.com/i);
    }
  });

  it("accepts the canonical host and its subdomains", () => {
    const http = client();
    expect(http.resolveUrl("https://udaybooking.com/in")).toBe("https://udaybooking.com/in");
    expect(http.resolveUrl("/in/pricing")).toBe("https://udaybooking.com/in/pricing");
  });

  it("refuses non-http protocols", () => {
    expect(() => client().resolveUrl("file:///etc/passwd")).toThrowError(/unsupported protocol/i);
  });
});

describe("HttpClient — failure handling", () => {
  it("maps 404 to NOT_FOUND with a hint about market-prefixed paths", async () => {
    handle = mockFetch({ statusByPath: { "/in/nope": 404 } });
    await expect(client().fetchText("/in/nope")).rejects.toThrowError(/returned 404/);
    try {
      await client().fetchText("/in/nope");
    } catch (error) {
      expect((error as UdayBookingError).code).toBe("NOT_FOUND");
      expect((error as UdayBookingError).hint).toMatch(/udaybooking_list_pages/);
    }
  });

  it("retries a transient network failure and then succeeds", async () => {
    handle = mockFetch({ flakyPaths: { "/in/pricing": 2 } });
    const res = await client({ maxRetries: 3 }).fetchText("/in/pricing");
    expect(res.status).toBe(200);
    // One failed attempt, a second failed attempt, then success.
    expect(handle.calls.filter((p) => p === "/in/pricing")).toHaveLength(3);
  });

  it("gives up after maxRetries and reports the condition as retryable", async () => {
    handle = mockFetch({ flakyPaths: { "/in/pricing": 99 } });
    try {
      await client({ maxRetries: 1 }).fetchText("/in/pricing");
      expect.unreachable("should have thrown");
    } catch (error) {
      const e = error as UdayBookingError;
      expect(e.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(e.retryable).toBe(true);
    }
    expect(handle.calls.filter((p) => p === "/in/pricing")).toHaveLength(2);
  });

  it("times out a hanging request and says which setting to raise", async () => {
    handle = mockFetch({ hangingPaths: ["/in/pricing"] });
    try {
      await client({ maxRetries: 0, requestTimeoutMs: 60 }).fetchText("/in/pricing");
      expect.unreachable("should have thrown");
    } catch (error) {
      const e = error as UdayBookingError;
      expect(e.code).toBe("TIMEOUT");
      expect(e.hint).toMatch(/UDAYBOOKING_REQUEST_TIMEOUT_MS/);
    }
  });

  it("treats 429 as rate limiting and suggests lowering concurrency", async () => {
    handle = mockFetch({ statusByPath: { "/in/pricing": 429 } });
    try {
      await client({ maxRetries: 0 }).fetchText("/in/pricing");
      expect.unreachable("should have thrown");
    } catch (error) {
      const e = error as UdayBookingError;
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.hint).toMatch(/UDAYBOOKING_MAX_CONCURRENCY/);
    }
  });

  it("surfaces a 500 as a retryable upstream error", async () => {
    handle = mockFetch({ statusByPath: { "/in/pricing": 503 } });
    try {
      await client({ maxRetries: 0 }).fetchText("/in/pricing");
      expect.unreachable("should have thrown");
    } catch (error) {
      const e = error as UdayBookingError;
      expect(e.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(e.status).toBe(503);
      expect(e.retryable).toBe(true);
    }
  });
});

describe("HttpClient — politeness", () => {
  it("spaces consecutive requests by minRequestIntervalMs", async () => {
    handle = mockFetch();
    const http = client({ minRequestIntervalMs: 40, maxConcurrency: 4 });
    const started = Date.now();
    await Promise.all([
      http.fetchText("/in/pricing"),
      http.fetchText("/in/help"),
      http.fetchText("/in/docs/availability"),
    ]);
    // Three requests, each gated 40ms apart, so at least ~80ms must elapse.
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });

  it("never exceeds the configured concurrency", async () => {
    handle = mockFetch();
    const http = client({ maxConcurrency: 2, minRequestIntervalMs: 0 });
    let inFlight = 0;
    let peak = 0;

    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 15));
        return await original(...args);
      } finally {
        inFlight--;
      }
    }) as typeof fetch;

    try {
      await Promise.all(
        ["/in", "/in/pricing", "/in/help", "/in/docs/availability", "/security"].map((p) =>
          http.fetchText(p),
        ),
      );
    } finally {
      globalThis.fetch = original;
    }

    expect(peak).toBeLessThanOrEqual(2);
  });
});
