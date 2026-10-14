import { afterEach, describe, expect, it } from "vitest";
import { SiteClient } from "../src/services/site-client.js";
import { HttpClient } from "../src/services/http-client.js";
import { loadConfig, type Config } from "../src/config.js";
import { createLogger } from "../src/utils/logger.js";
import type { UdayBookingError } from "../src/utils/errors.js";
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
  return { site, mock: handle };
}

describe("SiteClient — catalogue", () => {
  it("merges all three sitemaps and deduplicates overlapping URLs", async () => {
    const { site } = build();
    const catalog = await site.getCatalog();

    // /in/docs/availability appears in both markets-adjacent and resources sets.
    const availability = catalog.filter((e) => e.path === "/in/docs/availability");
    expect(availability).toHaveLength(1);
    expect(catalog.map((e) => e.path)).toContain("/docs/availability");
    expect(catalog.map((e) => e.path)).toContain("/us/pricing");
  });

  it("caches a complete catalogue so repeated calls do not refetch", async () => {
    const { site, mock } = build();
    await site.getCatalog();
    const first = mock.calls.length;
    await site.getCatalog();
    expect(mock.calls.length).toBe(first);
  });

  it("reports which sitemaps failed instead of silently serving a partial catalogue", async () => {
    const { site } = build({ flakyPaths: { "/sitemaps/pages.xml": 99 } }, { maxRetries: 0 });
    const result = await site.getCatalogResult();

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("/sitemaps/pages.xml");
    // The markets and resources sitemaps still loaded.
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("retries the missing sitemaps on the next call after a partial load", async () => {
    // Fail pages.xml once, then let it succeed — the second call must recover it.
    const { site, mock } = build({ flakyPaths: { "/sitemaps/pages.xml": 1 } }, { maxRetries: 0 });

    const partial = await site.getCatalogResult();
    expect(partial.failures).toHaveLength(1);
    expect(partial.entries.some((e) => e.path === "/docs/availability")).toBe(false);

    const complete = await site.getCatalogResult();
    expect(complete.failures).toHaveLength(0);
    expect(complete.entries.some((e) => e.path === "/docs/availability")).toBe(true);
    expect(mock.calls.filter((p) => p === "/sitemaps/pages.xml")).toHaveLength(2);
  });

  it("throws a retryable error when no sitemap can be read at all", async () => {
    const { site } = build(
      {
        flakyPaths: {
          "/sitemaps/pages.xml": 99,
          "/sitemaps/markets.xml": 99,
          "/sitemaps/resources.xml": 99,
        },
      },
      { maxRetries: 0 },
    );

    await expect(site.getCatalog()).rejects.toThrowError(/Could not load any sitemap/);
  });
});

describe("SiteClient — pages", () => {
  it("parses a page into the document model", async () => {
    const { site } = build();
    const page = await site.getPage("/in/docs/availability");

    expect(page.title).toBe("Availability · Docs — India — udaybooking");
    expect(page.market).toBe("in");
    expect(page.section).toBe("docs");
    expect(page.breadcrumbs).toEqual(["Home", "Docs", "Availability"]);
    expect(page.markdown).toContain("# Availability");
    expect(page.text).not.toContain("Getting started"); // sidebar stripped
  });

  it("caches a fetched page", async () => {
    const { site, mock } = build();
    await site.getPage("/in/docs/availability");
    await site.getPage("/in/docs/availability");
    expect(mock.calls.filter((p) => p === "/in/docs/availability")).toHaveLength(1);
  });

  it("propagates a NOT_FOUND for a path the site does not publish", async () => {
    const { site } = build();
    await expect(site.getPage("/in/not-a-real-page")).rejects.toThrowError(/404/);
  });
});

describe("SiteClient — offers", () => {
  it("extracts both billing currencies with their unit price specification", async () => {
    const { site } = build();
    const offers = await site.getOffers("/in/pricing");

    const inrPro = offers.find((o) => o.plan === "Professional" && o.currency === "INR");
    expect(inrPro).toMatchObject({
      price: 899,
      unit: "per user per month",
      billingMonths: 1,
    });

    const usdPro = offers.find((o) => o.plan === "Professional" && o.currency === "USD");
    expect(usdPro?.price).toBe(10);

    expect(offers.filter((o) => o.plan === "Free").map((o) => o.price)).toEqual([0, 0]);
  });

  it("reports NOT_FOUND, with a usable hint, on a page carrying no offers", async () => {
    const { site } = build();
    try {
      await site.getOffers("/security");
      expect.unreachable("should have thrown");
    } catch (error) {
      const e = error as UdayBookingError;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.hint).toMatch(/pricing pages/i);
    }
  });
});

describe("SiteClient — FAQs", () => {
  it("extracts question and answer pairs from FAQPage data", async () => {
    const { site } = build();
    const faqs = await site.getFaqs("/in/help");

    expect(faqs).toHaveLength(3);
    expect(faqs[0]).toMatchObject({
      question: "How does a guest reschedule?",
      answer: "From the link in their confirmation or reminder email.",
    });
    expect(faqs[0]?.sourceUrl).toContain("/in/help");
  });

  it("returns an empty list, not an error, for a page with no FAQ", async () => {
    const { site } = build();
    await expect(site.getFaqs("/security")).resolves.toEqual([]);
  });
});

describe("SiteClient — llms.txt", () => {
  it("fetches and caches the site summary", async () => {
    const { site, mock } = build();
    const first = await site.getLlmsTxt();
    const second = await site.getLlmsTxt();

    expect(first).toContain("udaybooking is a scheduling and appointment tool");
    expect(second).toBe(first);
    expect(mock.calls.filter((p) => p === "/llms.txt")).toHaveLength(1);
  });
});
