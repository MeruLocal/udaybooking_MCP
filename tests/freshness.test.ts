import { afterEach, describe, expect, it } from "vitest";
import { SearchIndex } from "../src/services/search-index.js";
import { SiteClient } from "../src/services/site-client.js";
import { HttpClient } from "../src/services/http-client.js";
import { loadConfig, type Config } from "../src/config.js";
import { createLogger } from "../src/utils/logger.js";
import { DOC_HTML, SITEMAP_PAGES } from "./fixtures.js";
import { mockFetch, type MockHandle, type MockOptions } from "./mock-fetch.js";

/**
 * The catalogue and the search index expire after their TTL and refresh in
 * the background (stale-while-revalidate), so a long-running process does not
 * serve the site as it was at startup.
 */

let handle: MockHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
});

const HOUR = 3_600_000;

function build(mock: MockOptions) {
  handle = mockFetch(mock);
  let clock = 1_000_000;
  const now = () => clock;
  const config: Config = {
    ...loadConfig({}),
    minRequestIntervalMs: 0,
    retryBaseDelayMs: 1,
    maxRetries: 0,
    requestTimeoutMs: 100,
    cacheTtlMs: 0, // no page cache: the index TTL alone decides freshness here
    logLevel: "silent",
  };
  const logger = createLogger(config);
  const site = new SiteClient(new HttpClient(config, logger), config, logger, now);
  const index = new SearchIndex(site, logger, config.indexMaxPages, config.indexTtlMs, now);
  return {
    site,
    index,
    mock: handle,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const sitemapCalls = (h: MockHandle) => h.calls.filter((c) => c.startsWith("/sitemaps/")).length;

describe("catalogue TTL", () => {
  it("makes no fetch inside the TTL", async () => {
    const { site, mock } = build({});
    await site.getCatalog();
    const first = sitemapCalls(mock);
    await site.getCatalog();
    expect(sitemapCalls(mock)).toBe(first);
  });

  it("after the TTL, serves the old catalogue while refreshing, then the new one", async () => {
    const routes: Record<string, string> = {};
    const { site, mock, advance } = build({ routes });
    const before = (await site.getCatalog()).map((e) => e.path);
    expect(before).not.toContain("/new-page");

    routes["/sitemaps/pages.xml"] = SITEMAP_PAGES.replace(
      "</urlset>",
      "<url><loc>https://udaybooking.com/new-page</loc></url></urlset>",
    );
    advance(7 * HOUR);
    const calls = sitemapCalls(mock);
    const during = (await site.getCatalog()).map((e) => e.path);
    expect(during).toEqual(before); // stale-while-revalidate
    await site.settled();
    expect(sitemapCalls(mock)).toBeGreaterThan(calls);
    expect((await site.getCatalog()).map((e) => e.path)).toContain("/new-page");
  });

  it("keeps the old catalogue when a refresh fails", async () => {
    const statusByPath: Record<string, number> = {};
    const { site, advance } = build({ statusByPath });
    const before = await site.getCatalog();
    for (const p of ["/sitemaps/pages.xml", "/sitemaps/markets.xml", "/sitemaps/resources.xml"]) {
      statusByPath[p] = 503;
    }
    advance(7 * HOUR);
    await site.getCatalog();
    await site.settled();
    expect(await site.getCatalog()).toEqual(before);
  });
});

describe("search index TTL", () => {
  it("rebuilds after the TTL: the new text becomes searchable and the old snippet goes", async () => {
    const routes: Record<string, string> = {};
    const { index, advance } = build({ routes });

    const old = await index.search("availability", "international", undefined, 5);
    expect(old.hits.length).toBeGreaterThan(0);
    expect((await index.search("zebracorn", "international", undefined, 5)).hits).toHaveLength(0);

    routes["/docs/availability"] = DOC_HTML.replace(/availability/gi, "zebracorn");
    advance(7 * HOUR);

    // Still the old index while the rebuild runs...
    await index.search("zebracorn", "international", undefined, 5);
    await index.settled();

    const fresh = await index.search("zebracorn", "international", undefined, 5);
    expect(fresh.hits.map((h) => h.path)).toContain("/docs/availability");
    expect(fresh.builtAt).toBeGreaterThan(old.builtAt);
    const stillOld = await index.search("availability", "international", undefined, 5);
    expect(stillOld.hits.map((h) => h.path)).not.toContain("/docs/availability");
  });

  it("does not rebuild inside the TTL", async () => {
    const { index, mock, advance } = build({});
    await index.search("availability", "international", undefined, 5);
    const calls = mock.calls.length;
    advance(HOUR);
    await index.search("availability", "international", undefined, 5);
    await index.settled();
    expect(mock.calls.length).toBe(calls);
  });
});
