import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  extractJsonLd,
  extractMain,
  extractMeta,
  extractReadableBody,
  extractTitle,
  flattenJsonLdNodes,
  hasType,
  htmlToMarkdown,
  htmlToText,
  stripElements,
} from "../src/utils/html.js";
import { classify, parsePage, parseUrlSet } from "../src/services/site-client.js";
import {
  DOC_HTML,
  PRICING_HTML,
  SITEMAP_MARKETS,
  SITEMAP_PAGES,
} from "./fixtures.js";

describe("HTML entities", () => {
  it("decodes the named, numeric and hex entities the site uses", () => {
    expect(decodeEntities("&#8377;899")).toBe("₹899");
    expect(decodeEntities("round robin &mdash; fair")).toBe("round robin — fair");
    expect(decodeEntities("WhatsApp, SMS &amp; email")).toBe("WhatsApp, SMS & email");
    expect(decodeEntities("&#x27;quoted&#x27;")).toBe("'quoted'");
  });

  it("leaves an unknown entity untouched rather than mangling it", () => {
    expect(decodeEntities("&notanentity;")).toBe("&notanentity;");
  });
});

describe("Landmark extraction", () => {
  it("narrows a page to its <main> landmark", () => {
    const main = extractMain(DOC_HTML);
    expect(main).toContain("Working hours decide");
    expect(main).not.toContain("data-section=\"navbar\"");
  });

  it("returns the whole document when there is no <main>", () => {
    const html = "<html><body><p>bare</p></body></html>";
    expect(extractMain(html)).toBe(html);
  });

  it("strips navigational chrome so docs text is not swamped by it", () => {
    const body = extractReadableBody(DOC_HTML);
    const text = htmlToText(body);
    expect(text).toContain("Working hours decide when a booking type can be booked.");
    // Sidebar, breadcrumb, prev/next, navbar and footer links must all be gone.
    expect(text).not.toContain("Getting started");
    expect(text).not.toContain("Features Resources Pricing");
    expect(text).not.toContain("Privacy Terms");
  });

  it("removes the documentation sidebar, including its disclosure heading", () => {
    // The real sidebar is <aside><details><summary>Browse documentation</summary>
    // …<nav>…, so stripping <nav> alone would leave the heading and labels.
    const text = htmlToText(extractReadableBody(DOC_HTML));
    expect(text).not.toContain("Browse documentation");
    expect(text).not.toContain("Basics");
  });

  it("removes balanced nested elements without truncating the rest", () => {
    const html = "<a>keep1<nav>drop<nav>inner</nav>more</nav>keep2</a>";
    expect(stripElements(html, ["nav"])).toBe("<a>keep1keep2</a>");
  });

  it("keeps the remainder when markup is unbalanced", () => {
    const html = "<p>before</p><nav>unclosed";
    expect(stripElements(html, ["nav"])).toContain("before");
  });
});

describe("Text and Markdown rendering", () => {
  it("preserves heading levels and list bullets in Markdown", () => {
    const md = htmlToMarkdown(extractReadableBody(PRICING_HTML));
    expect(md).toContain("# Pricing");
    expect(md).toContain("## Professional");
    expect(md).toContain("- Team scheduling — round robin, collective and group");
  });

  it("drops script and style content entirely", () => {
    const html = "<main><script>var secret=1</script><style>.a{}</style><p>visible</p></main>";
    const text = htmlToText(html);
    expect(text).toBe("visible");
  });
});

describe("Metadata and JSON-LD", () => {
  it("reads the title and meta description", () => {
    expect(extractTitle(PRICING_HTML)).toBe("udaybooking pricing in India — udaybooking");
    const meta = extractMeta(PRICING_HTML);
    expect(meta.description).toMatch(/free plan for one user/);
    expect(meta["og:locale"]).toBe("en_IN");
  });

  it("parses the JSON-LD graph into typed nodes", () => {
    const nodes = flattenJsonLdNodes(extractJsonLd(PRICING_HTML));
    expect(nodes.some((n) => hasType(n, "FAQPage"))).toBe(true);
    expect(nodes.some((n) => hasType(n, "SoftwareApplication"))).toBe(true);
    expect(nodes.some((n) => hasType(n, "BreadcrumbList"))).toBe(true);
  });

  it("skips a malformed JSON-LD block instead of losing the page", () => {
    const html =
      '<script type="application/ld+json">{ broken </script>' +
      '<script type="application/ld+json">{"@type":"WebPage","name":"ok"}</script>';
    const nodes = flattenJsonLdNodes(extractJsonLd(html));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe("ok");
  });

  it("orders breadcrumbs by position, not document order", () => {
    // The pricing fixture deliberately lists position 2 before position 1.
    const page = parsePage("https://udaybooking.com/in/pricing", PRICING_HTML);
    expect(page.breadcrumbs).toEqual(["Home", "Pricing"]);
  });

  it("reads article dates and section from TechArticle", () => {
    const page = parsePage("https://udaybooking.com/in/docs/availability", DOC_HTML);
    expect(page.datePublished).toBe("2026-05-01");
    expect(page.dateModified).toBe("2026-09-20");
    expect(page.articleSection).toBe("Scheduling");
  });
});

describe("Sitemap parsing and classification", () => {
  it("reads loc, changefreq and priority", () => {
    const entries = parseUrlSet(SITEMAP_PAGES);
    expect(entries).toHaveLength(5);
    expect(entries[0]).toEqual({
      loc: "https://udaybooking.com",
      changefreq: "monthly",
      priority: 1,
    });
    // The terms entry carries neither optional field.
    expect(entries[4]).toEqual({ loc: "https://udaybooking.com/terms" });
  });

  it("classifies unprefixed URLs as the international edition", () => {
    const entry = classify({ loc: "https://udaybooking.com/docs/availability" });
    expect(entry?.market).toBe("international");
    expect(entry?.section).toBe("docs");
    expect(entry?.slug).toBe("availability");
  });

  it("classifies market-prefixed URLs by their two-letter prefix", () => {
    const entries = parseUrlSet(SITEMAP_MARKETS).map((e) => classify(e));
    expect(entries[0]?.market).toBe("in");
    expect(entries[0]?.section).toBe("home");
    expect(entries[2]?.market).toBe("us");
    expect(entries[2]?.section).toBe("pricing");
  });

  it("groups company and legal pages into their own sections", () => {
    expect(classify({ loc: "https://udaybooking.com/in/about" })?.section).toBe("company");
    expect(classify({ loc: "https://udaybooking.com/in/terms" })?.section).toBe("legal");
    expect(classify({ loc: "https://udaybooking.com/in/demo" })?.section).toBe("company");
  });

  it("does not mistake a non-market two-letter path for a market", () => {
    // 'docs' is not a market code, so the page stays international.
    expect(classify({ loc: "https://udaybooking.com/docs" })?.market).toBe("international");
  });

  it("ignores an unparseable loc rather than throwing", () => {
    expect(classify({ loc: "not a url" })).toBeUndefined();
  });
});
