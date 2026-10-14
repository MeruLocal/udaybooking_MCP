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
        "data, in each currency the page publishes (udaybooking_get_pricing).",
    },
    {
      capability: "Published FAQ answers",
      detail:
        "Exact authored question-and-answer pairs from schema.org FAQPage data: the FAQ " +
        "pairs published on the help centre and pricing page (udaybooking_get_faqs).",
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
        "This server reads published website content only, so it cannot create a booking. " +
        "Bookings are made in Udaybooking itself, and no public booking API reference is " +
        "published yet.",
      whatWouldUnblockIt:
        "Documentation for the 'agent endpoints' the site advertises: base URL, " +
        "authentication scheme, request and response schemas, and confirmation that " +
        "automated booking is permitted.",
    },
    {
      capability: "Check real availability or slots",
      reason:
        "Availability is computed per host from their connected calendars inside Udaybooking " +
        "itself. This server reads published website content only, and no public " +
        "availability API reference is published yet.",
      whatWouldUnblockIt: "A published availability API reference.",
    },
    {
      capability: "List, modify or cancel bookings",
      reason:
        "These are signed-in operations inside Udaybooking itself. This server reads published " +
        "website content only and holds no user session.",
      whatWouldUnblockIt: "API documentation plus an authentication method (API key or OAuth).",
    },
    {
      capability: "Sign in or act as a user",
      reason:
        "This server never signs in and stores no credentials at all. People sign in to " +
        "Udaybooking themselves from udaybooking.com.",
      whatWouldUnblockIt:
        "A published API with a documented authentication method (API key or OAuth).",
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
        "management API reference is published yet.",
      whatWouldUnblockIt: "Webhook management API documentation.",
    },
    {
      capability: "Anything under /api/",
      reason:
        "udaybooking.com's robots.txt sets 'Disallow: /api/' for every user agent, including " +
        "ClaudeBot. This server refuses those paths rather than relying on callers to avoid them.",
      whatWouldUnblockIt:
        "A robots.txt change or explicit written permission from Udaybooking, together with " +
        "a published API reference.",
    },
  ],

  evidence: [
    "robots.txt: 'User-Agent: *' with 'Allow: /' and 'Disallow: /api/'; the same pair is " +
      "repeated for ClaudeBot, Claude-User and Claude-SearchBot. Sitemap declared at /sitemap.xml.",
    "The site is a prerendered Next.js application: responses carry 'x-nextjs-prerender: 1', " +
      "so every page is complete server-rendered HTML and no browser engine is needed to read it.",
    "'Agent endpoints' are mentioned on /integrations, /docs/workflows and /help, but no public " +
      "API reference (base URL, authentication scheme or schema) is published yet.",
    "Terms of service (last updated 29 September 2026) prohibit disrupting, reverse-engineering " +
      "and unauthorised access. Reading published pages within robots.txt is consistent with them; " +
      "probing undocumented endpoints would not be.",
    "Useful structured data is published and is used by this server: SoftwareApplication.offers " +
      "on pricing pages, FAQPage on /help and /pricing, TechArticle on docs, " +
      "BlogPosting with dates on posts, and BreadcrumbList site-wide.",
  ],
};

/** Renders the report as Markdown for a tool or resource response. */
export function renderCapabilityReport(): string {
  const r = CAPABILITY_REPORT;
  const lines = [
    "# Udaybooking automation capabilities",
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
