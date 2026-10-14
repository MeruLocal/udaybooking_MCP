import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { CAPABILITY_REPORT } from "../src/capabilities.js";
import { TOOL_CATALOG, TOOL_NAMES } from "../src/tool-catalog.js";
import { mockFetch, type MockHandle, type MockOptions } from "./mock-fetch.js";

/**
 * Protocol-level tests: a real MCP client talks to the real server over an
 * in-memory transport, so tool registration, schema validation and result
 * shapes are all exercised through the SDK rather than by calling handlers
 * directly.
 */

let handle: MockHandle | undefined;
let client: Client;

async function connect(mock: MockOptions = {}): Promise<Client> {
  handle = mockFetch(mock);
  const { server } = buildServer({
    minRequestIntervalMs: 0,
    retryBaseDelayMs: 1,
    requestTimeoutMs: 150,
    logLevel: "silent",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  return c;
}

/** Reads the first text block of a tool result. */
function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

beforeEach(async () => {
  client = await connect();
});

afterEach(async () => {
  await client.close();
  handle?.restore();
  handle = undefined;
});

describe("tool registration", () => {
  it("registers exactly the eight implemented tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "udaybooking_get_automation_capabilities",
      "udaybooking_get_faqs",
      "udaybooking_get_page",
      "udaybooking_get_pricing",
      "udaybooking_get_site_summary",
      "udaybooking_list_markets",
      "udaybooking_list_pages",
      "udaybooking_search_content",
    ]);
  });

  it("registers no booking, availability or payment tool", async () => {
    // Guards the central honesty property: there is nothing to book against,
    // so no tool may imply otherwise.
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).join(" ");
    for (const forbidden of ["create_booking", "cancel_booking", "check_availability", "pay"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("marks every tool read-only and non-destructive", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
  });

  it("gives every tool a description and an output schema", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(200);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("keeps TOOL_CATALOG in step with the tools actually registered", async () => {
    // The landing page, /version and /.well-known/mcp.json all advertise
    // TOOL_CATALOG. The SDK exposes no public way to enumerate registered tools,
    // so this test is what stops that declared list drifting from reality.
    const { tools } = await client.listTools();
    expect([...TOOL_NAMES].sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("gives every catalogued tool a usable summary", () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool.summary.length, tool.name).toBeGreaterThan(20);
      expect(tool.summary.endsWith("."), tool.name).toBe(true);
    }
  });

  it("exposes the capabilities and site-summary resources", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "udaybooking://capabilities",
      "udaybooking://llms.txt",
    ]);
  });
});

describe("input validation", () => {
  /**
   * The SDK validates `inputSchema` before the handler runs and reports a
   * failure as an error *result* (isError: true) rather than a rejected
   * promise, so these assert on the returned result.
   */
  async function expectValidationError(
    name: string,
    args: Record<string, unknown>,
    pattern: RegExp,
  ): Promise<void> {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, `${name} should have reported a validation error`).toBe(true);
    expect(textOf(result)).toMatch(pattern);
  }

  it("rejects a query below the minimum length", async () => {
    await expectValidationError(
      "udaybooking_search_content",
      { query: "a" },
      /at least 2 characters|too_small|validation/i,
    );
  });

  it("rejects an unknown market code", async () => {
    await expectValidationError(
      "udaybooking_search_content",
      { query: "booking", market: "zz" },
      /invalid|expected/i,
    );
  });

  it("rejects a limit above the documented maximum", async () => {
    await expectValidationError(
      "udaybooking_search_content",
      { query: "booking", limit: 500 },
      /too_big|less than|<=\s*25|validation/i,
    );
  });

  it("rejects a missing required argument", async () => {
    await expectValidationError(
      "udaybooking_get_page",
      {},
      /expected string, received undefined|required|validation/i,
    );
  });

  it("rejects a booking tool name that does not exist", async () => {
    // Also documents the shape a client sees when a model guesses at a tool
    // this server deliberately does not provide.
    await expectValidationError("udaybooking_create_booking", {}, /not found/i);
  });

  it("applies documented defaults when optional arguments are omitted", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_faqs",
      arguments: {}, // source defaults to 'help', market to 'international'
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { source: string }).source).toBe("help");
  });
});

describe("read-only tools over fixtures", () => {
  it("lists pages with pagination metadata", async () => {
    const result = await client.callTool({
      name: "udaybooking_list_pages",
      arguments: { market: "international", limit: 2 },
    });
    const structured = result.structuredContent as {
      total: number;
      count: number;
      has_more: boolean;
      next_offset?: number;
    };
    expect(structured.count).toBe(2);
    expect(structured.has_more).toBe(true);
    expect(structured.next_offset).toBe(2);
  });

  it("returns structured pricing filtered by currency", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_pricing",
      arguments: { market: "in", currency: "INR" },
    });
    const structured = result.structuredContent as {
      offers: { plan: string; currency: string; price: number }[];
    };
    expect(structured.offers.every((o) => o.currency === "INR")).toBe(true);
    expect(structured.offers.find((o) => o.plan === "Professional")?.price).toBe(899);
  });

  it("notes that Enterprise carries no machine-readable price", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_pricing",
      arguments: { market: "in" },
    });
    expect(textOf(result)).toMatch(/Enterprise is quoted/i);
  });

  it("filters FAQs by query and reports the total available", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_faqs",
      arguments: { source: "help", query: "reschedule" },
    });
    const structured = result.structuredContent as { count: number; total_available: number };
    expect(structured.count).toBe(1);
    expect(structured.total_available).toBe(3);
  });

  it("explains itself when a FAQ filter matches nothing", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_faqs",
      arguments: { source: "help", query: "nonexistent-topic" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/No help FAQ entry matched/);
  });

  it("returns a page as Markdown with its metadata", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_page",
      arguments: { path: "/in/docs/availability" },
    });
    const text = textOf(result);
    expect(text).toContain("Home › Docs › Availability");
    expect(text).toContain("Working hours decide");
  });

  it("truncates a page to max_chars and says so", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_page",
      arguments: { path: "/in/docs/timezones", max_chars: 500 },
    });
    const structured = result.structuredContent as { truncated: boolean; original_length: number };
    expect(structured.truncated).toBe(true);
    expect(structured.original_length).toBeGreaterThan(500);
    expect(textOf(result)).toMatch(/Truncated: showing/);
  });

  it("does not flag truncation for a page inside the budget", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_page",
      arguments: { path: "/in/docs/availability", max_chars: 5_000 },
    });
    expect((result.structuredContent as { truncated: boolean }).truncated).toBe(false);
  });

  it("omits JSON-LD unless asked, and includes it when asked", async () => {
    const without = await client.callTool({
      name: "udaybooking_get_page",
      arguments: { path: "/in/pricing" },
    });
    expect((without.structuredContent as { json_ld?: unknown[] }).json_ld).toBeUndefined();

    const with_ = await client.callTool({
      name: "udaybooking_get_page",
      arguments: { path: "/in/pricing", include_json_ld: true },
    });
    expect((with_.structuredContent as { json_ld?: unknown[] }).json_ld?.length).toBeGreaterThan(0);
  });

  it("searches and returns scored hits with snippets", async () => {
    const result = await client.callTool({
      name: "udaybooking_search_content",
      arguments: { query: "working hours", market: "international" },
    });
    const structured = result.structuredContent as {
      results: { path: string; score: number; snippets: string[] }[];
    };
    expect(structured.results[0]?.path).toBe("/docs/availability");
    expect(structured.results[0]?.score).toBeGreaterThan(0);
  });

  it("reports an empty search honestly, naming the index size", async () => {
    const result = await client.callTool({
      name: "udaybooking_search_content",
      arguments: { query: "unrelated gibberish term", market: "international" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/No pages in the 'international' edition matched/);
  });

  it("returns every market plus the international edition", async () => {
    const result = await client.callTool({ name: "udaybooking_list_markets", arguments: {} });
    const structured = result.structuredContent as { count: number; markets: { code: string }[] };
    expect(structured.count).toBe(8);
    expect(structured.markets.map((m) => m.code)).toContain("international");
  });

  it("returns the site summary", async () => {
    const result = await client.callTool({ name: "udaybooking_get_site_summary", arguments: {} });
    expect(textOf(result)).toContain("scheduling and appointment tool");
  });

  it("supports a JSON response format on every tool that offers it", async () => {
    for (const name of [
      "udaybooking_list_markets",
      "udaybooking_get_automation_capabilities",
      "udaybooking_list_pages",
    ]) {
      const result = await client.callTool({ name, arguments: { response_format: "json" } });
      expect(() => JSON.parse(textOf(result)), name).not.toThrow();
    }
  });
});

describe("safeguards against claiming booking capability", () => {
  it("reports no public API and no booking support", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_automation_capabilities",
      arguments: {},
    });
    const structured = result.structuredContent as {
      public_api_available: boolean;
      not_supported: { capability: string }[];
    };

    expect(structured.public_api_available).toBe(false);
    const unsupported = structured.not_supported.map((n) => n.capability).join(" | ");
    expect(unsupported).toMatch(/Create a booking/);
    expect(unsupported).toMatch(/List, modify or cancel bookings/);
    expect(unsupported).toMatch(/Payments/);
  });

  it("gives every unsupported capability a reason and a route to unblocking it", () => {
    for (const item of CAPABILITY_REPORT.notSupported) {
      expect(item.reason.length, item.capability).toBeGreaterThan(40);
      expect(item.whatWouldUnblockIt.length, item.capability).toBeGreaterThan(10);
    }
  });

  it("refuses a robots-disallowed path through the tool layer", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_page",
      arguments: { path: "/api/v1/bookings" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/robots\.txt disallows/);
  });

  it("refuses an off-host URL through the tool layer", async () => {
    const result = await client.callTool({
      name: "udaybooking_get_page",
      arguments: { path: "https://example.com/" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/only reads udaybooking\.com/);
  });

  it("states in its server instructions that it cannot book", async () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toMatch(/READ-ONLY/);
    expect(instructions).toMatch(/CANNOT/);
  });
});

describe("upstream failure handling at the tool layer", () => {
  it("returns an actionable error rather than throwing when the site is unreachable", async () => {
    await client.close();
    handle?.restore();
    client = await connect({ flakyPaths: { "/in/pricing": 99 } });

    const result = await client.callTool({
      name: "udaybooking_get_pricing",
      arguments: { market: "in" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Could not reach|UPSTREAM_UNAVAILABLE/);
  });

  it("returns a timeout error naming the setting to raise", async () => {
    await client.close();
    handle?.restore();
    client = await connect({ hangingPaths: ["/llms.txt"] });

    const result = await client.callTool({
      name: "udaybooking_get_site_summary",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/TIMEOUT|timed out/);
  });

  it("warns that the catalogue is incomplete instead of reporting a false absence", async () => {
    await client.close();
    handle?.restore();
    client = await connect({ flakyPaths: { "/sitemaps/pages.xml": 99 } });

    const result = await client.callTool({
      name: "udaybooking_list_pages",
      arguments: { market: "international", section: "docs" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/catalogue is incomplete/);
  });
});
