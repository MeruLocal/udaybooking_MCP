import { afterEach, describe, expect, it } from "vitest";
import { SearchIndex, buildSnippets, tokenize } from "../src/services/search-index.js";
import { SiteClient } from "../src/services/site-client.js";
import { HttpClient } from "../src/services/http-client.js";
import { loadConfig, type Config } from "../src/config.js";
import { createLogger } from "../src/utils/logger.js";
import { mockFetch, type MockHandle, type MockOptions } from "./mock-fetch.js";

let handle: MockHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
});

function build(mock: MockOptions = {}, overrides: Partial<Config> = {}) {
  handle = mockFetch(mock);
  const config: Config = {
    ...loadConfig({}),
    minRequestIntervalMs: 0,
    retryBaseDelayMs: 1,
    requestTimeoutMs: 100,
    logLevel: "silent",
    ...overrides,
  };
  const logger = createLogger(config);
  const site = new SiteClient(new HttpClient(config, logger), config, logger);
  return {
    index: new SearchIndex(site, logger, config.indexMaxPages),
    mock: handle,
  };
}

describe("tokenize", () => {
  it("lowercases, drops stopwords and de-duplicates", () => {
    expect(tokenize("How do I set the Availability for a Booking?")).toEqual([
      "set",
      "availability",
      "booking",
    ]);
  });

  it("keeps hyphenated terms and discards punctuation", () => {
    expect(tokenize("round-robin, collective!")).toEqual(["round-robin", "collective"]);
  });

  it("returns nothing for a query made only of stopwords", () => {
    expect(tokenize("how can I do it")).toEqual([]);
  });
});

describe("buildSnippets", () => {
  it("cuts an excerpt around the match with ellipses", () => {
    const text = `${"filler ".repeat(40)}booking window limits how far ahead${" tail".repeat(40)}`;
    const [snippet] = buildSnippets(text, ["booking"]);
    expect(snippet).toContain("booking window limits");
    expect(snippet?.startsWith("…")).toBe(true);
  });

  it("does not emit two excerpts for matches that sit close together", () => {
    const text = "availability and booking window are related settings";
    expect(buildSnippets(text, ["availability", "booking"])).toHaveLength(1);
  });

  it("returns nothing when no term is present", () => {
    expect(buildSnippets("unrelated text", ["absent"])).toEqual([]);
  });
});

describe("SearchIndex", () => {
  it("finds a page by body text and reports the index size", async () => {
    const { index } = build();
    const result = await index.search("working hours", "international", undefined, 5);

    expect(result.indexedPages).toBeGreaterThan(0);
    expect(result.hits[0]?.path).toBe("/docs/availability");
    expect(result.hits[0]?.snippets[0]).toContain("Working hours");
  });

  it("ranks a title match above a body-only match", async () => {
    const { index } = build();
    const result = await index.search("pricing", "international", undefined, 5);
    expect(result.hits[0]?.path).toBe("/pricing");
  });

  it("returns no hits for a query that matches nothing", async () => {
    const { index } = build();
    const result = await index.search("quantum tunnelling", "international", undefined, 5);
    expect(result.hits).toEqual([]);
    expect(result.indexedPages).toBeGreaterThan(0);
  });

  it("returns no hits when the query is entirely stopwords", async () => {
    const { index } = build();
    const result = await index.search("how can it be", "international", undefined, 5);
    expect(result.hits).toEqual([]);
  });

  it("applies the sections filter", async () => {
    const { index } = build();
    const result = await index.search("pricing", "international", ["docs"], 5);
    expect(result.hits.every((h) => h.section === "docs")).toBe(true);
  });

  it("honours the result limit", async () => {
    const { index } = build();
    const result = await index.search("udaybooking", "international", undefined, 1);
    expect(result.hits.length).toBeLessThanOrEqual(1);
  });

  it("builds each market index once and reuses it", async () => {
    const { index, mock } = build();
    await index.search("availability", "international", undefined, 5);
    const afterFirst = mock.calls.length;
    await index.search("booking window", "international", undefined, 5);
    expect(mock.calls.length).toBe(afterFirst);
  });

  it("respects the page budget, keeping documentation over lower-priority sections", async () => {
    const { index } = build({}, { indexMaxPages: 1 });
    const result = await index.search("availability", "international", undefined, 5);

    expect(result.indexedPages).toBe(1);
    // 'docs' ranks first in the section priority list, so it survives the cap.
    expect(result.hits[0]?.section).toBe("docs");
  });

  it("records pages it could not fetch rather than dropping them silently", async () => {
    const { index } = build({ statusByPath: { "/docs/availability": 500 } }, { maxRetries: 0 });
    const result = await index.search("pricing", "international", undefined, 5);
    expect(result.failedPaths).toContain("/docs/availability");
  });
});
