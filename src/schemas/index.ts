import { z } from "zod";
import { INTERNATIONAL, MARKET_CODES, SECTIONS } from "../constants.js";

/**
 * Zod shapes for every tool's input and output.
 *
 * Shapes (plain objects of Zod types) are exported rather than `z.object(...)`
 * wrappers because that is what the MCP SDK's `registerTool` expects for
 * `inputSchema` / `outputSchema`.
 */

/** Market selector shared by most tools. */
export const MarketEnum = z
  .enum([...MARKET_CODES, INTERNATIONAL] as [string, ...string[]])
  .describe(
    "Market edition of the site. Two-letter codes: 'in' (India), 'us', 'gb', 'au', 'nz', " +
      "'sg', 'ae'. Use 'international' for the unprefixed edition.",
  );

export const SectionEnum = z
  .enum([...SECTIONS] as [string, ...string[]])
  .describe(
    "Top-level section of the site: home, product, solutions, docs, guides, blog, help, " +
      "resources, pricing, integrations, security, how-it-works, company, legal.",
  );

export const ResponseFormatEnum = z
  .enum(["markdown", "json"])
  .describe("'markdown' for prose a human can read, 'json' for machine-readable output.");

/* ------------------------------------------------------------------ inputs */

export const SearchContentInput = {
  query: z
    .string()
    .trim()
    .min(2, "query must be at least 2 characters")
    .max(200, "query must not exceed 200 characters")
    .describe("Free-text query, e.g. 'round robin availability' or 'whatsapp reminders'."),
  market: MarketEnum.default(INTERNATIONAL),
  sections: z
    .array(SectionEnum)
    .max(14)
    .optional()
    .describe("Restrict results to these sections. Omit to search every indexed section."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(8)
    .describe("Maximum number of results to return (1-25, default 8)."),
  response_format: ResponseFormatEnum.default("markdown"),
};

export const GetPageInput = {
  path: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      "Site-relative path such as '/in/docs/availability', or a full " +
        "https://udaybooking.com/... URL. Paths under '/api/' are refused because " +
        "udaybooking.com's robots.txt disallows them.",
    ),
  max_chars: z
    .number()
    .int()
    .min(500)
    .max(25_000)
    .default(12_000)
    .describe("Character budget for the page body; longer pages are truncated with a note."),
  include_json_ld: z
    .boolean()
    .default(false)
    .describe("Include the page's raw schema.org JSON-LD nodes in the response."),
  response_format: ResponseFormatEnum.default("markdown"),
};

export const ListPagesInput = {
  market: MarketEnum.optional().describe("Filter to one market. Omit for every market."),
  section: SectionEnum.optional().describe("Filter to one section. Omit for every section."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(60)
    .describe("Maximum entries to return (1-200, default 60)."),
  offset: z.number().int().min(0).default(0).describe("Entries to skip, for pagination."),
  response_format: ResponseFormatEnum.default("markdown"),
};

export const GetPricingInput = {
  market: MarketEnum.default(INTERNATIONAL),
  currency: z
    .string()
    .trim()
    .regex(/^(all|[A-Za-z]{3})$/, "currency must be a three-letter ISO code or 'all'")
    .default("all")
    .describe(
      "Filter machine-readable offers by billing currency (three-letter ISO code), or 'all'. " +
        "The result lists the currencies the page publishes.",
    ),
  include_page_text: z
    .boolean()
    .default(false)
    .describe("Also return the pricing page's prose (plan features, limits, discounts)."),
  response_format: ResponseFormatEnum.default("markdown"),
};

export const GetFaqsInput = {
  source: z
    .enum(["help", "pricing"])
    .default("help")
    .describe(
      "Which FAQ set to read. 'help' is the help centre (accounts, availability, guests, " +
        "teams, reminders and polls); 'pricing' is the pricing FAQ (plans, trials, platform " +
        "fees and currency). The result reports how many pairs the page publishes.",
    ),
  market: MarketEnum.default(INTERNATIONAL),
  query: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .optional()
    .describe("Optional filter; only Q&A pairs matching these words are returned."),
  limit: z.number().int().min(1).max(50).default(25).describe("Maximum Q&A pairs to return."),
  response_format: ResponseFormatEnum.default("markdown"),
};

export const ListMarketsInput = {
  response_format: ResponseFormatEnum.default("markdown"),
};

export const GetSiteSummaryInput = {
  response_format: ResponseFormatEnum.default("markdown"),
};

export const GetAutomationCapabilitiesInput = {
  response_format: ResponseFormatEnum.default("markdown"),
};

/* ----------------------------------------------------------------- outputs */

export const SearchContentOutput = {
  query: z.string(),
  market: z.string(),
  count: z.number().int(),
  indexed_pages: z.number().int().describe("Pages in the index that was searched."),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      path: z.string(),
      section: z.string(),
      score: z.number(),
      snippets: z.array(z.string()),
    }),
  ),
  unavailable_paths: z
    .array(z.string())
    .describe("Catalogue paths that could not be fetched, so partial results are visible."),
};

export const GetPageOutput = {
  url: z.string(),
  path: z.string(),
  market: z.string(),
  section: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  locale: z.string().optional(),
  breadcrumbs: z.array(z.string()),
  date_published: z.string().optional(),
  date_modified: z.string().optional(),
  content: z.string(),
  truncated: z.boolean(),
  original_length: z.number().int(),
  json_ld: z.array(z.record(z.string(), z.unknown())).optional(),
};

export const ListPagesOutput = {
  total: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
  next_offset: z.number().int().optional(),
  pages: z.array(
    z.object({
      path: z.string(),
      url: z.string(),
      market: z.string(),
      section: z.string(),
      slug: z.string(),
      change_frequency: z.string().optional(),
      priority: z.number().optional(),
    }),
  ),
};

export const GetPricingOutput = {
  market: z.string(),
  source_url: z.string(),
  offers: z.array(
    z.object({
      plan: z.string(),
      price: z.number(),
      currency: z.string(),
      unit: z.string().optional(),
      billing_months: z.number().optional(),
      description: z.string().optional(),
    }),
  ),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  page_text: z.string().optional(),
  notes: z.array(z.string()),
};

export const GetFaqsOutput = {
  source: z.string(),
  source_url: z.string(),
  market: z.string(),
  count: z.number().int(),
  total_available: z.number().int(),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
};

export const ListMarketsOutput = {
  count: z.number().int(),
  markets: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      locale: z.string(),
      path_prefix: z.string(),
      home_url: z.string(),
    }),
  ),
  notes: z.array(z.string()),
};

export const GetSiteSummaryOutput = {
  source_url: z.string(),
  content: z.string(),
  truncated: z.boolean(),
};

export const GetAutomationCapabilitiesOutput = {
  verified_at: z.string(),
  public_api_available: z.boolean(),
  browser_automation_used: z.boolean(),
  supported: z.array(z.object({ capability: z.string(), detail: z.string() })),
  not_supported: z.array(
    z.object({ capability: z.string(), reason: z.string(), what_would_unblock_it: z.string() }),
  ),
  evidence: z.array(z.string()),
};

export const GetStartedInput = {
  market: MarketEnum.default(INTERNATIONAL),
  response_format: ResponseFormatEnum.default("markdown"),
};

export const GetStartedOutput = {
  market: z.string(),
  call_to_action: z.string(),
  links: z
    .array(
      z.object({
        kind: z.enum(["pricing", "contact", "demo"]),
        title: z.string(),
        url: z.string(),
      }),
    )
    .describe("Next-step pages that exist on the site for this market, UTM-tagged."),
  signup_note: z.string().describe("How to sign up; no signup URL is returned until one is confirmed."),
  notes: z.array(z.string()),
};
