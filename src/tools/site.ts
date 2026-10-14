import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../services/site-client.js";
import type { Logger } from "../utils/logger.js";
import {
  GetAutomationCapabilitiesInput,
  GetAutomationCapabilitiesOutput,
  GetSiteSummaryInput,
  GetSiteSummaryOutput,
  ListMarketsInput,
  ListMarketsOutput,
} from "../schemas/index.js";
import { INTERNATIONAL, LLMS_TXT_PATH, MARKETS, SITE_ORIGIN } from "../constants.js";
import { CAPABILITY_REPORT, renderCapabilityReport } from "../capabilities.js";

const MARKET_NAMES = MARKETS.map((m) => m.name).join(", ");
import { clamp, guard, ok } from "./helpers.js";

/** Registers `udaybooking_list_markets`. */
export function registerMarketsTool(server: McpServer, logger: Logger): void {
  server.registerTool(
    "udaybooking_list_markets",
    {
      title: "List udaybooking country markets",
      description: `List the country editions of udaybooking.com and the path prefix each one uses.

Use this to resolve a country name to the market code other tools expect, or to confirm whether a country has a localised edition at all.

Args:
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: each market's two-letter code, country name, locale, path prefix and home URL, plus notes on how the editions are addressed.

The country editions (${MARKET_NAMES}) come from the site's markets sitemap; the unprefixed international edition is addressed as 'international'. For what differs between markets, read each market's pages rather than assuming.

Examples:
  - Use when: "Does udaybooking have a Singapore site?" -> returns code 'sg'
  - Don't use when: you already know the code (pass it straight to another tool)

Error handling: this tool reads a fixed list enumerated from the site's markets sitemap and makes no network request, so it does not fail on network errors.`,
      inputSchema: ListMarketsInput,
      outputSchema: ListMarketsOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard<{ response_format: "markdown" | "json" }>(
      logger,
      "udaybooking_list_markets",
      async (args) => {
        const markets = [
          ...MARKETS.map((m) => ({
            code: m.code,
            name: m.name,
            locale: m.locale,
            path_prefix: `/${m.code}`,
            home_url: `${SITE_ORIGIN}/${m.code}`,
          })),
          {
            code: INTERNATIONAL,
            name: "International (unprefixed)",
            locale: "en",
            path_prefix: "",
            home_url: SITE_ORIGIN,
          },
        ];

        const notes = [
          "Each country edition lives under its two-letter path prefix; the international edition is unprefixed.",
          "Countries without their own edition are served by the international site.",
          "For prices and currencies in a market, call udaybooking_get_pricing with that market.",
        ];

        const structured = { count: markets.length, markets, notes };

        if (args.response_format === "json") {
          return ok(JSON.stringify(structured, null, 2), structured);
        }

        const lines = [
          "# udaybooking markets",
          "",
          "| Code | Country | Locale | Prefix |",
          "| --- | --- | --- | --- |",
          ...markets.map(
            (m) => `| \`${m.code}\` | ${m.name} | ${m.locale} | \`${m.path_prefix || "(none)"}\` |`,
          ),
          "",
          "## Notes",
          "",
          ...notes.map((n) => `- ${n}`),
        ];

        return ok(lines.join("\n"), structured);
      },
    ),
  );
}

/** Registers `udaybooking_get_site_summary`. */
export function registerSiteSummaryTool(
  server: McpServer,
  site: SiteClient,
  logger: Logger,
): void {
  server.registerTool(
    "udaybooking_get_site_summary",
    {
      title: "Get udaybooking's own site summary (llms.txt)",
      description: `Fetch /llms.txt — the machine-readable site summary udaybooking publishes specifically for language models.

This is the cheapest way to get oriented: one request returns the product overview, the plan prices, every documentation page, guide and blog post with its description, the country list, and the site's own answers to common questions.

Call this first when you need a broad picture of what udaybooking is or does, before deciding which page to read in detail.

Args:
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: the full text of llms.txt, its source URL, and whether it was truncated to fit the response budget.

Examples:
  - Use when: "What is udaybooking and what can it do?"
  - Use when: you want the documentation index without three sitemap requests
  - Don't use when: you need one page in depth (use udaybooking_get_page)

Error handling: returns an actionable upstream error if /llms.txt cannot be fetched; the site intermittently drops connections and retries usually succeed.`,
      inputSchema: GetSiteSummaryInput,
      outputSchema: GetSiteSummaryOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard<{ response_format: "markdown" | "json" }>(
      logger,
      "udaybooking_get_site_summary",
      async (args) => {
        const raw = await site.getLlmsTxt();
        const body = clamp(raw, 20_000);

        const structured = {
          source_url: `${SITE_ORIGIN}${LLMS_TXT_PATH}`,
          content: body.text,
          truncated: body.truncated,
        };

        if (args.response_format === "json") {
          return ok(JSON.stringify(structured, null, 2), structured);
        }
        return ok(body.text, structured);
      },
    ),
  );
}

/** Registers `udaybooking_get_automation_capabilities`. */
export function registerCapabilitiesTool(server: McpServer, logger: Logger): void {
  server.registerTool(
    "udaybooking_get_automation_capabilities",
    {
      title: "What this server can and cannot do with udaybooking",
      description: `Report exactly which udaybooking operations this server supports, which it does not, and why — based on a recorded inspection of the live site.

Call this before telling a user that udaybooking can or cannot be automated, and whenever a request involves creating, changing, paying for, cancelling or listing a booking. It prevents claiming a capability that does not exist.

The short answer: this server is read-only over published content. udaybooking.com publishes no documented public API, and no booking, availability, account or payment operation can be performed through it.

Args:
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: when the site was verified, whether a public API exists, the supported capabilities, the unsupported ones each with the reason and what would unblock it, and the evidence behind those conclusions.

Examples:
  - Use when: "Book me a 30-minute slot tomorrow" -> explains that booking is not available and why
  - Use when: "Can Claude cancel my udaybooking appointment?" -> returns the verified answer
  - Use when: a user asks for the API docs

Error handling: this tool reads a recorded report and makes no network request, so it cannot fail on network errors.`,
      inputSchema: GetAutomationCapabilitiesInput,
      outputSchema: GetAutomationCapabilitiesOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard<{ response_format: "markdown" | "json" }>(
      logger,
      "udaybooking_get_automation_capabilities",
      async (args) => {
        const structured = {
          verified_at: CAPABILITY_REPORT.verifiedAt,
          public_api_available: CAPABILITY_REPORT.publicApiAvailable,
          browser_automation_used: CAPABILITY_REPORT.browserAutomationUsed,
          supported: CAPABILITY_REPORT.supported,
          not_supported: CAPABILITY_REPORT.notSupported.map((n) => ({
            capability: n.capability,
            reason: n.reason,
            what_would_unblock_it: n.whatWouldUnblockIt,
          })),
          evidence: CAPABILITY_REPORT.evidence,
        };

        if (args.response_format === "json") {
          return ok(JSON.stringify(structured, null, 2), structured);
        }
        return ok(renderCapabilityReport(), structured);
      },
    ),
  );
}
