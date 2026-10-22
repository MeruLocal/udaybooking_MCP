import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { SITEMAP_PAGES } from "./fixtures.js";
import { mockFetch, type MockHandle } from "./mock-fetch.js";

const PAGE = (title: string, desc: string) =>
  `<!DOCTYPE html><html><head><title>${title}</title><meta name="description" content="${desc}"></head><body><main id="main"><h1>${title}</h1><p>${desc}</p></main></body></html>`;

let handle: MockHandle | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  handle?.restore();
});

describe("udaybooking_list_comparisons", () => {
  it("splits landing pages into alternatives and use cases, with page-sourced titles", async () => {
    handle = mockFetch({
      routes: {
        "/sitemaps/pages.xml": SITEMAP_PAGES.replace(
          "</urlset>",
          `<url><loc>https://udaybooking.com/calendly-alternative</loc></url><url><loc>https://udaybooking.com/round-robin-scheduling</loc></url></urlset>`,
        ),
        "/calendly-alternative": PAGE("Calendly alternative", "How it compares."),
        "/round-robin-scheduling": PAGE("Round robin scheduling", "Share leads fairly."),
      },
    });
    const { server } = buildServer({ minRequestIntervalMs: 0, retryBaseDelayMs: 1, logLevel: "silent" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "t", version: "1" });
    await Promise.all([client.connect(a), server.connect(b)]);

    const all = (await client.callTool({
      name: "udaybooking_list_comparisons",
      arguments: { response_format: "json" },
    })) as { structuredContent: { count: number; pages: { path: string; kind: string; title?: string; url: string }[] } };
    expect(all.structuredContent.count).toBe(2);
    const alt = all.structuredContent.pages.find((p) => p.path === "/calendly-alternative");
    expect(alt?.kind).toBe("alternative");
    expect(alt?.title).toBe("Calendly alternative");
    expect(alt?.url).toContain("utm_source=mcp");

    const only = (await client.callTool({
      name: "udaybooking_list_comparisons",
      arguments: { kind: "use_cases", response_format: "json" },
    })) as { structuredContent: { pages: { path: string }[] } };
    expect(only.structuredContent.pages.map((p) => p.path)).toEqual(["/round-robin-scheduling"]);
  });
});
