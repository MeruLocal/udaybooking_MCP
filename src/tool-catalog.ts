/**
 * One-line summaries of the registered tools, for the HTTP landing page,
 * `/version` and the discovery document.
 *
 * This is a declared list rather than runtime introspection, because the MCP
 * SDK exposes no public API for enumerating a server's tools. To stop it
 * drifting from reality, `tests/server.test.ts` asserts that these names match
 * exactly what an MCP client sees from `tools/list` — so adding or renaming a
 * tool without updating this file fails the suite.
 */
export interface ToolSummary {
  name: string;
  summary: string;
}

export const TOOL_CATALOG: readonly ToolSummary[] = [
  {
    name: "udaybooking_search_content",
    summary: "Full-text search across published documentation, guides, help centre and blog.",
  },
  {
    name: "udaybooking_get_page",
    summary: "Read one page as Markdown, with its metadata and schema.org data.",
  },
  {
    name: "udaybooking_list_pages",
    summary: "List published pages from the site's own sitemaps, by market and section.",
  },
  {
    name: "udaybooking_get_pricing",
    summary: "Plans and prices from the pricing page's structured schema.org offers.",
  },
  {
    name: "udaybooking_get_faqs",
    summary: "Published question-and-answer pairs from the help centre and pricing FAQ.",
  },
  {
    name: "udaybooking_list_markets",
    summary: "The country editions of the site, plus the international one.",
  },
  {
    name: "udaybooking_get_site_summary",
    summary: "The machine-readable site summary udaybooking publishes at /llms.txt.",
  },
  {
    name: "udaybooking_get_automation_capabilities",
    summary: "What this server can and cannot do with udaybooking, and the evidence.",
  },
  {
    name: "udaybooking_get_started",
    summary: "Where to go next to try or buy: pricing, and contact or demo pages when published.",
  },
];

export const TOOL_NAMES: readonly string[] = TOOL_CATALOG.map((t) => t.name);
