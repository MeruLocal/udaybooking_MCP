import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { CAPABILITY_REPORT, renderCapabilityReport } from "../src/capabilities.js";
import { PRICING_HTML } from "./fixtures.js";
import { mockFetch, type MockHandle, type MockOptions } from "./mock-fetch.js";

/**
 * Commercial claims (prices, discounts, currencies, plan names) must come from
 * the site at call time, never from text typed into this server. Clients cache
 * tool lists and agents treat descriptions as authoritative, so the
 * descriptions and the capability report are checked here.
 */

let handle: MockHandle | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  handle?.restore();
  handle = undefined;
  client = undefined;
});

async function connect(mock: MockOptions = {}): Promise<Client> {
  handle = mockFetch(mock);
  const { server } = buildServer({ minRequestIntervalMs: 0, retryBaseDelayMs: 1, logLevel: "silent" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([c.connect(a), server.connect(b)]);
  return c;
}

const FORBIDDEN: [string, RegExp][] = [
  ["a percentage", /\b\d+%/],
  ["a currency code", /\bUSD\b|\bINR\b/],
  // "Free-text query" is not a plan name, hence the hyphen guard.
  ["a plan name", /\b(Free|Professional|Enterprise)\b(?!-)/],
  ["a hard-coded FAQ count", /\b\d+ (on the help|Q&A|pairs on)/i],
];

describe("no hard-coded commercial claims", () => {
  it("tool descriptions and input-schema text carry none", async () => {
    client = await connect();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const text = `${tool.description ?? ""}\n${JSON.stringify(tool.inputSchema)}`;
      for (const [what, re] of FORBIDDEN) {
        expect(re.test(text), `${tool.name} description contains ${what}`).toBe(false);
      }
    }
  });

  it("the capability report carries none", () => {
    const text = `${renderCapabilityReport()}\n${JSON.stringify(CAPABILITY_REPORT)}`;
    for (const [what, re] of FORBIDDEN) {
      expect(re.test(text), `capability report contains ${what}`).toBe(false);
    }
  });

  it("lists every currency the page publishes, including a third one", async () => {
    const withEuro = PRICING_HTML.replace(
      '{"@type":"Offer","name":"Free","price":0,"priceCurrency":"USD"',
      '{"@type":"Offer","name":"Free","price":0,"priceCurrency":"EUR","description":"x"},' +
        '{"@type":"Offer","name":"Free","price":0,"priceCurrency":"USD"',
    );
    client = await connect({ routes: { "/in/pricing": withEuro } });
    const result = await client.callTool({ name: "udaybooking_get_pricing", arguments: { market: "in" } });
    const notes = (result.structuredContent as { notes: string[] }).notes.join("\n");
    expect(notes).toContain("Currencies published on this page: EUR, USD, INR.");

    const eur = await client.callTool({
      name: "udaybooking_get_pricing",
      arguments: { market: "in", currency: "eur" },
    });
    const offers = (eur.structuredContent as { offers: { currency: string }[] }).offers;
    expect(offers.map((o) => o.currency)).toEqual(["EUR"]);
  });

  it("reports FAQ counts from the fetched page", async () => {
    client = await connect();
    const result = await client.callTool({
      name: "udaybooking_get_faqs",
      arguments: { source: "pricing", market: "in" },
    });
    const s = result.structuredContent as { total_available: number };
    // The pricing fixture publishes exactly two FAQ pairs.
    expect(s.total_available).toBe(2);
  });
});
