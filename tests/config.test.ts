import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

/**
 * Port resolution has its own tests because getting it wrong is invisible
 * locally and breaks only in a container: the server starts, logs a healthy
 * line, and listens on a port nothing is mapped to.
 *
 * The contract is UDAYBOOKING_HTTP_PORT ?? PORT ?? 3004. The Dockerfile must
 * therefore NOT set UDAYBOOKING_HTTP_PORT, or it pins the first branch on every
 * container and `-e PORT=...` is silently ignored.
 */
describe("port resolution", () => {
  it("defaults to 3004 when nothing is set", () => {
    expect(loadConfig({}).httpPort).toBe(3004);
  });

  it("honours PORT, the convention orchestrators and PaaS hosts use", () => {
    expect(loadConfig({ PORT: "3020" }).httpPort).toBe(3020);
  });

  it("lets the explicit UDAYBOOKING_HTTP_PORT win over PORT", () => {
    const config = loadConfig({ UDAYBOOKING_HTTP_PORT: "4100", PORT: "3020" });
    expect(config.httpPort).toBe(4100);
  });

  it("falls through to PORT when the specific var is absent, not merely empty-ish", () => {
    // Guards the `??` semantics: an unset variable is undefined, and only
    // undefined may fall through.
    expect(loadConfig({ UDAYBOOKING_HTTP_PORT: undefined, PORT: "3020" }).httpPort).toBe(3020);
  });

  it("rejects a port outside the valid TCP range", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrowError(/configuration/i);
    expect(() => loadConfig({ PORT: "0" })).toThrowError(/configuration/i);
  });

  it("rejects a non-numeric port rather than silently falling back", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrowError(/configuration/i);
  });
});

describe("host resolution", () => {
  it("binds loopback by default, because the server has no authentication", () => {
    expect(loadConfig({}).httpHost).toBe("127.0.0.1");
  });

  it("honours UDAYBOOKING_HTTP_HOST, which the container image sets to 0.0.0.0", () => {
    expect(loadConfig({ UDAYBOOKING_HTTP_HOST: "0.0.0.0" }).httpHost).toBe("0.0.0.0");
  });
});

describe("politeness defaults", () => {
  it("keeps concurrency and request spacing conservative by default", () => {
    const config = loadConfig({});
    // udaybooking.com answers a burst by refusing connections for minutes.
    expect(config.maxConcurrency).toBe(2);
    expect(config.minRequestIntervalMs).toBe(250);
  });

  it("reports which setting was wrong when a value is out of range", () => {
    expect(() => loadConfig({ UDAYBOOKING_MAX_CONCURRENCY: "99" })).toThrowError(
      /maxConcurrency/,
    );
  });
});

describe("HTTP hardening defaults", () => {
  it("has a rate limit, session cap, host allowlist, and no proxy trust by default", () => {
    const config = loadConfig({});
    expect(config.httpRateLimitPerMin).toBe(60);
    expect(config.httpMaxSessions).toBe(100);
    expect(config.httpAllowedHosts).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
      "mcp.udaybooking.com",
    ]);
    expect(config.trustProxy).toBe(false);
    expect(config.publicBaseUrl).toBeUndefined();
    expect(config.maxResponseBytes).toBe(5_000_000);
  });

  it("treats an empty PUBLIC_BASE_URL as unset and strips a trailing slash", () => {
    expect(loadConfig({ PUBLIC_BASE_URL: "" }).publicBaseUrl).toBeUndefined();
    expect(loadConfig({ PUBLIC_BASE_URL: "https://mcp.udaybooking.com/" }).publicBaseUrl).toBe(
      "https://mcp.udaybooking.com",
    );
    expect(() => loadConfig({ PUBLIC_BASE_URL: "not a url" })).toThrowError(/publicBaseUrl/);
  });

  it("parses TRUST_PROXY, the rate limit (0 disables) and the host list", () => {
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(true);
    expect(loadConfig({ UDAYBOOKING_HTTP_RATE_LIMIT_PER_MIN: "0" }).httpRateLimitPerMin).toBe(0);
    expect(loadConfig({ UDAYBOOKING_HTTP_ALLOWED_HOSTS: " A.example , b.example " }).httpAllowedHosts).toEqual([
      "a.example",
      "b.example",
    ]);
  });
});

describe("freshness and usage defaults", () => {
  it("expires the catalogue and index after 6 hours by default; 0 keeps them forever", () => {
    expect(loadConfig({}).catalogTtlMs).toBe(21_600_000);
    expect(loadConfig({}).indexTtlMs).toBe(21_600_000);
    expect(loadConfig({ UDAYBOOKING_CATALOG_TTL_MS: "0" }).catalogTtlMs).toBe(0);
    expect(loadConfig({ UDAYBOOKING_INDEX_TTL_MS: "0" }).indexTtlMs).toBe(0);
  });

  it("logs tool usage by default, and UDAYBOOKING_USAGE_LOG=0 turns it off", () => {
    expect(loadConfig({}).usageLog).toBe(true);
    expect(loadConfig({ UDAYBOOKING_USAGE_LOG: "0" }).usageLog).toBe(false);
  });
});
