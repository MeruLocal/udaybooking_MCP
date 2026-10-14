import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { SITEMAP_MARKETS } from "./fixtures.js";
import { mockFetch, type MockHandle, type MockOptions } from "./mock-fetch.js";

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

interface Started {
  links: { kind: string; url: string }[];
  signup_note: string;
}

describe("udaybooking_get_started", () => {
  it("is registered read-only", async () => {
    client = await connect();
    const tool = (await client.listTools()).tools.find((t) => t.name === "udaybooking_get_started");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.annotations?.destructiveHint).toBe(false);
  });

  it("returns a UTM-tagged pricing URL and no invented signup path", async () => {
    client = await connect();
    const result = await client.callTool({ name: "udaybooking_get_started", arguments: { market: "in" } });
    const s = result.structuredContent as Started;
    expect(s.links.map((l) => l.kind)).toEqual(["pricing"]);
    const pricing = new URL(s.links[0]?.url ?? "");
    expect(pricing.pathname).toBe("/in/pricing");
    expect(pricing.searchParams.get("utm_campaign")).toBe("udaybooking_get_started");
    const all = JSON.stringify(result);
    expect(all).not.toMatch(/\/signup|app\.udaybooking/i);
    expect(s.signup_note).toMatch(/udaybooking\.com/);
  });

  it("adds contact and demo only when the sitemap lists them for that market", async () => {
    const withContact = SITEMAP_MARKETS.replace(
      "</urlset>",
      "  <url><loc>https://udaybooking.com/in/contact</loc></url>\n" +
        "  <url><loc>https://udaybooking.com/us/demo</loc></url>\n</urlset>",
    );
    client = await connect({ routes: { "/sitemaps/markets.xml": withContact } });
    const inResult = await client.callTool({ name: "udaybooking_get_started", arguments: { market: "in" } });
    expect((inResult.structuredContent as Started).links.map((l) => l.kind)).toEqual(["pricing", "contact"]);
    const usResult = await client.callTool({ name: "udaybooking_get_started", arguments: { market: "us" } });
    expect((usResult.structuredContent as Started).links.map((l) => l.kind)).toEqual(["pricing", "demo"]);
  });
});

describe("UTM on own-site links in other tools", () => {
  it("tags pricing, faqs, markets and page URLs", async () => {
    client = await connect();
    const pricing = await client.callTool({ name: "udaybooking_get_pricing", arguments: { market: "in" } });
    expect((pricing.structuredContent as { source_url: string }).source_url).toContain(
      "utm_campaign=udaybooking_get_pricing",
    );
    const faqs = await client.callTool({ name: "udaybooking_get_faqs", arguments: { market: "in" } });
    expect((faqs.structuredContent as { source_url: string }).source_url).toContain("utm_source=mcp");
    const markets = await client.callTool({ name: "udaybooking_list_markets", arguments: {} });
    const homes = (markets.structuredContent as { markets: { home_url: string }[] }).markets;
    expect(homes.every((m) => m.home_url.includes("utm_medium=ai_agent"))).toBe(true);
    const page = await client.callTool({ name: "udaybooking_get_page", arguments: { path: "/in/pricing" } });
    expect((page.structuredContent as { url: string }).url).toContain("utm_campaign=udaybooking_get_page");
  });
});
