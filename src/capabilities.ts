/**
 * Recorded result of inspecting udaybooking.com.
 *
 * This file is the server's honesty mechanism. Every claim below was observed in
 * a live response on the date given; nothing is inferred from the product's
 * marketing copy. It is surfaced both as a tool
 * (`udaybooking_get_automation_capabilities`) and as an MCP resource, so a model
 * can check what is genuinely possible before promising a user anything.
 *
 * If udaybooking later publishes an API, update this file and add the tools —
 * do not quietly widen the claims here.
 */

export interface CapabilityReport {
  verifiedAt: string;
  publicApiAvailable: boolean;
  browserAutomationUsed: boolean;
  supported: { capability: string; detail: string }[];
  notSupported: { capability: string; reason: string; whatWouldUnblockIt: string }[];
  evidence: string[];
}

export const CAPABILITY_REPORT: CapabilityReport = {
  verifiedAt: "2026-10-13",
  publicApiAvailable: false,
  browserAutomationUsed: false,

  supported: [
    {
      capability: "Read published pages",
      detail:
        "Any page in the site's sitemaps — documentation, guides, help centre, blog, " +
        "product, solutions, pricing, integrations, security, company and legal pages — " +
        "returned as Markdown with metadata (udaybooking_get_page).",
    },
    {
      capability: "Search published content",
      detail:
        "Local full-text search over the sitemap-listed pages, with scored excerpts " +
        "(udaybooking_search_content). Built locally because the site exposes no search endpoint.",
    },
    {
      capability: "Plans and prices",
      detail:
        "Structured plan offers from the pricing page's schema.org SoftwareApplication.offers " +
        "data, in both billing currencies (udaybooking_get_pricing).",
    },
    {
      capability: "Published FAQ answers",
      detail:
        "Exact authored question-and-answer pairs from schema.org FAQPage data: 22 on the " +
        "help centre, 9 on the pricing page (udaybooking_get_faqs).",
    },
    {
      capability: "Page catalogue and markets",
      detail:
        "The site's own sitemap index, classified by market and section " +
        "(udaybooking_list_pages, udaybooking_list_markets).",
    },
  ],

  notSupported: [
    {
      capability: "Create a booking",
      reason:
        "udaybooking.com publishes no booking endpoint and no booking form. The booking " +
        "widget on the marketing pages is a static interactive mock: the sample link it " +
        "shows (/alex/consultation) does not resolve. The product application that would " +
        "host real booking pages is advertised at app.udaybooking.com, which does not serve " +
        "udaybooking (see evidence).",
      whatWouldUnblockIt:
        "Documentation for the 'agent endpoints' the site advertises: base URL, " +
        "authentication scheme, request and response schemas, and confirmation that " +
        "automated booking is permitted.",
    },
    {
      capability: "Check real availability or slots",
      reason:
        "Availability is computed per host from their connected calendars inside the " +
        "product application. No public endpoint or public host booking page exists to read it from.",
      whatWouldUnblockIt: "An availability endpoint specification, or a reachable public booking page URL.",
    },
    {
      capability: "List, modify or cancel bookings",
      reason:
        "These are authenticated operations inside the product application. There is no " +
        "published API, and no reachable login to hold a session against.",
      whatWouldUnblockIt: "API documentation plus an authentication method (API key or OAuth).",
    },
    {
      capability: "Sign in or act as a user",
      reason:
        "The site's Log in and Sign up links point to https://app.udaybooking.com, which " +
        "returns an unrelated single-page application on every route. There is no udaybooking " +
        "login to authenticate against. This server therefore stores no credentials at all.",
      whatWouldUnblockIt:
        "A working authentication surface, plus documented, permitted programmatic access to it.",
    },
    {
      capability: "Payments and subscription changes",
      reason:
        "No payment or billing endpoint is published. This server would not perform a " +
        "financial transaction even if one existed — payments require the account holder " +
        "to act themselves.",
      whatWouldUnblockIt: "Nothing: initiating payments is out of scope for this server by design.",
    },
    {
      capability: "Webhook configuration",
      reason:
        "Outbound webhooks on booking events are described on the integrations, workflows " +
        "and help pages, but they are configured inside the product application and no " +
        "management API is documented.",
      whatWouldUnblockIt: "Webhook management API documentation.",
    },
    {
      capability: "Anything under /api/",
      reason:
        "udaybooking.com's robots.txt sets 'Disallow: /api/' for every user agent, including " +
        "ClaudeBot. This server refuses those paths rather than relying on callers to avoid them.",
      whatWouldUnblockIt:
        "A robots.txt change or explicit written permission from udaybooking, together with " +
        "actual endpoint documentation.",
    },
  ],

  evidence: [
    "robots.txt: 'User-Agent: *' with 'Allow: /' and 'Disallow: /api/'; the same pair is " +
      "repeated for ClaudeBot, Claude-User and Claude-SearchBot. Sitemap declared at /sitemap.xml.",
    "The site is a prerendered Next.js application: responses carry 'x-nextjs-prerender: 1', " +
      "so every page is complete server-rendered HTML and no browser engine is needed to read it.",
    "app.udaybooking.com — the target of every Log in and Sign up link — returned a " +
      "byte-identical 46,784-byte single-page-application shell titled 'HelloGrowthCRM' for " +
      "/, /login, /signup, /api/v1/bookings and a nonsense path. It does not serve udaybooking.",
    "The booking page shown on the marketing site (udaybooking.com/alex/consultation) does not " +
      "resolve; the surrounding widget is labelled 'Interactive preview' in the page itself.",
    "'Agent endpoints — Book programmatically from your own app' appears on /integrations, and " +
      "/docs/workflows and /help repeat it in prose, but no base URL, authentication scheme or " +
      "schema is published anywhere on the site.",
    "Terms of service (last updated 29 September 2026) prohibit disrupting, reverse-engineering " +
      "and unauthorised access. Reading published pages within robots.txt is consistent with them; " +
      "probing undocumented endpoints would not be.",
    "Useful structured data is published and is used by this server: SoftwareApplication.offers " +
      "on pricing pages, FAQPage (22 pairs on /help, 9 on /pricing), TechArticle on docs, " +
      "BlogPosting with dates on posts, and BreadcrumbList site-wide.",
  ],
};

/** Renders the report as Markdown for a tool or resource response. */
export function renderCapabilityReport(): string {
  const r = CAPABILITY_REPORT;
  const lines = [
    "# udaybooking automation capabilities",
    "",
    `Verified against the live site on **${r.verifiedAt}**.`,
    "",
    `- **Documented public API available**: ${r.publicApiAvailable ? "yes" : "no"}`,
    `- **Browser automation used**: ${r.browserAutomationUsed ? "yes" : "no"} (not needed — the site is server-rendered)`,
    "",
    "This server is **read-only over published content**. It cannot create, read, change or",
    "cancel a booking, and it holds no credentials.",
    "",
    "## Supported",
    "",
  ];

  for (const s of r.supported) lines.push(`- **${s.capability}** — ${s.detail}`);

  lines.push("", "## Not supported", "");
  for (const n of r.notSupported) {
    lines.push(`### ${n.capability}`);
    lines.push(`- **Why**: ${n.reason}`);
    lines.push(`- **What would unblock it**: ${n.whatWouldUnblockIt}`);
    lines.push("");
  }

  lines.push("## Evidence", "");
  for (const e of r.evidence) lines.push(`- ${e}`);

  return lines.join("\n");
}
