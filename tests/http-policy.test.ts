import { describe, expect, it } from "vitest";
import {
  decideOrigin,
  isBrowserNavigation,
  isLoopbackOrigin,
} from "../src/services/http-policy.js";

describe("isBrowserNavigation", () => {
  it("detects an address-bar navigation by Sec-Fetch-Mode", () => {
    expect(
      isBrowserNavigation({
        secFetchMode: "navigate",
        secFetchDest: "document",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }),
    ).toBe(true);
  });

  it("detects a navigation by Sec-Fetch-Dest alone", () => {
    expect(isBrowserNavigation({ secFetchDest: "document" })).toBe(true);
  });

  it("falls back to an HTML-seeking Accept header", () => {
    expect(isBrowserNavigation({ accept: "text/html,*/*;q=0.8" })).toBe(true);
  });

  it("does not treat an MCP client's SSE request as a navigation", () => {
    // This is the critical negative: the MCP spec's GET carries text/event-stream
    // and must reach the transport, not the landing page.
    expect(isBrowserNavigation({ accept: "application/json, text/event-stream" })).toBe(false);
  });

  it("does not misread a browser fetch() that asks for an event stream", () => {
    expect(
      isBrowserNavigation({
        accept: "text/html, text/event-stream",
        secFetchMode: "cors",
        secFetchDest: "empty",
      }),
    ).toBe(false);
  });

  it("treats a request with no usable headers as protocol traffic", () => {
    expect(isBrowserNavigation({})).toBe(false);
    expect(isBrowserNavigation({ accept: "*/*" })).toBe(false);
    expect(isBrowserNavigation({ accept: "application/json" })).toBe(false);
  });
});

describe("isLoopbackOrigin", () => {
  it("accepts loopback hosts on any port", () => {
    for (const origin of [
      "http://localhost:3004",
      "http://127.0.0.1:6274",
      "https://localhost",
      "http://[::1]:8080",
    ]) {
      expect(isLoopbackOrigin(origin), origin).toBe(true);
    }
  });

  it("rejects remote origins, including lookalikes", () => {
    for (const origin of [
      "https://evil.example",
      "http://localhost.evil.example",
      "http://notlocalhost",
      "http://127.0.0.1.evil.example",
      "http://192.168.1.10:3004",
    ]) {
      expect(isLoopbackOrigin(origin), origin).toBe(false);
    }
  });

  it("rejects non-http schemes and malformed values", () => {
    expect(isLoopbackOrigin("file://localhost")).toBe(false);
    expect(isLoopbackOrigin("not an origin")).toBe(false);
    expect(isLoopbackOrigin("")).toBe(false);
  });
});

describe("decideOrigin", () => {
  it("allows a request with no Origin — every non-browser client", () => {
    expect(decideOrigin(undefined, [])).toEqual({ allowed: true, reason: "no-origin" });
    expect(decideOrigin("", [])).toEqual({ allowed: true, reason: "no-origin" });
    // Browsers send the literal string "null" for opaque origins.
    expect(decideOrigin("null", [])).toEqual({ allowed: true, reason: "no-origin" });
  });

  it("allows loopback origins by default", () => {
    expect(decideOrigin("http://localhost:6274", [])).toEqual({
      allowed: true,
      reason: "loopback",
    });
  });

  it("allows an explicitly configured origin", () => {
    expect(decideOrigin("https://studio.example", ["https://studio.example"])).toEqual({
      allowed: true,
      reason: "configured",
    });
  });

  it("refuses an origin that is neither loopback nor configured", () => {
    expect(decideOrigin("https://evil.example", ["https://studio.example"])).toEqual({
      allowed: false,
      reason: "not-allowed",
    });
  });

  it("still blocks a DNS-rebinding attempt", () => {
    // The attacker's domain resolves to 127.0.0.1, but the browser sends the
    // attacker's own origin — which is exactly why allowing loopback origins is
    // safe. This test is the reason that default is defensible.
    expect(decideOrigin("https://rebind.attacker.example", []).allowed).toBe(false);
  });

  it("can have the loopback allowance switched off", () => {
    expect(decideOrigin("http://localhost:6274", [], false)).toEqual({
      allowed: false,
      reason: "not-allowed",
    });
  });
});
