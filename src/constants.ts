/**
 * Verified facts about udaybooking.com, established by inspecting the live site
 * on 2026-10-13. Nothing in this file is assumed: every value was observed in a
 * response from the origin. See README.md ("Verified site functionality") for the
 * evidence behind each constant.
 */

/** Canonical origin of the public marketing + documentation site. */
export const SITE_ORIGIN = "https://udaybooking.com";

/**
 * The only host this server is ever allowed to contact. Requests are rejected
 * before they leave the process if they resolve to anything else, so a crafted
 * `path` argument cannot turn this server into an open proxy.
 */
export const ALLOWED_HOST = "udaybooking.com";

/**
 * The exact hostnames this server may fetch: the apex and `www`, nothing else.
 *
 * Deliberately not "any subdomain": a subdomain can point at third-party
 * infrastructure (an app host, a CDN, a future service), and a suffix match
 * would let a redirect or a crafted URL reach it. The operator-configured
 * `UDAYBOOKING_BASE_URL` host is also allowed (see `HttpClient`), so a staging
 * mirror still works.
 */
export const ALLOWED_HOSTS: readonly string[] = ["udaybooking.com", "www.udaybooking.com"];

/** Redirect hops followed per request before giving up. */
export const MAX_REDIRECTS = 5;

/** Sitemap index, plus the three child sitemaps it points at. */
export const SITEMAP_INDEX = "/sitemap.xml";
export const SITEMAP_CHILDREN = [
  "/sitemaps/pages.xml",
  "/sitemaps/markets.xml",
  "/sitemaps/resources.xml",
] as const;

/** The site's own machine-readable summary, intended for LLM consumption. */
export const LLMS_TXT_PATH = "/llms.txt";

/**
 * Path prefixes that robots.txt disallows for every user agent, including
 * ClaudeBot. Observed directive: `User-Agent: *` / `Allow: /` / `Disallow: /api/`.
 * This server refuses to fetch them rather than relying on the caller to behave.
 */
export const ROBOTS_DISALLOWED_PREFIXES = ["/api/"] as const;

/**
 * Country markets that have a localised section of the site. Enumerated from
 * /sitemaps/markets.xml, which contains exactly these seven two-letter prefixes.
 * The unprefixed site (`""`) is the international edition.
 */
export const MARKET_CODES = ["in", "us", "gb", "au", "nz", "sg", "ae"] as const;

export type MarketCode = (typeof MARKET_CODES)[number];

/** Typed so a market entry cannot name a code that is not in MARKET_CODES. */
export const MARKETS: readonly { code: MarketCode; name: string; locale: string }[] = [
  { code: "in", name: "India", locale: "en-IN" },
  { code: "us", name: "United States", locale: "en-US" },
  { code: "gb", name: "United Kingdom", locale: "en-GB" },
  { code: "au", name: "Australia", locale: "en-AU" },
  { code: "nz", name: "New Zealand", locale: "en-NZ" },
  { code: "sg", name: "Singapore", locale: "en-SG" },
  { code: "ae", name: "United Arab Emirates", locale: "en-AE" },
];

/** `international` is the sentinel for the unprefixed edition of the site. */
export const INTERNATIONAL = "international";

/**
 * Top-level sections observed in the sitemaps. Used to classify and filter the
 * page catalogue without refetching anything.
 */
export const SECTIONS = [
  "home",
  "product",
  "solutions",
  "docs",
  "guides",
  "blog",
  "help",
  "resources",
  "pricing",
  "integrations",
  "security",
  "how-it-works",
  "landing",
  "company",
  "legal",
] as const;

/**
 * Maximum characters in a single tool response. Oversized payloads are trimmed
 * with an explicit note so a client's context is never silently flooded.
 */
export const CHARACTER_LIMIT = 25_000;

/** Default page-body budget for a single `get_page` call, in characters. */
export const DEFAULT_PAGE_CHAR_BUDGET = 12_000;
