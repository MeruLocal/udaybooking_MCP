import { withUtm } from "../utils/utm.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../services/site-client.js";
import type { Logger } from "../utils/logger.js";
import { GetPricingInput, GetPricingOutput } from "../schemas/index.js";
import { clamp, guard, marketUrl, ok } from "./helpers.js";

interface Args {
  market: string;
  currency: string;
  include_page_text: boolean;
  response_format: "markdown" | "json";
}

/**
 * Registers `udaybooking_get_pricing`.
 *
 * Prices come from the pricing page's `SoftwareApplication.offers` JSON-LD —
 * machine-readable data the site publishes itself — not from scraped markup.
 * The prose is offered separately because plan features and limits are only in
 * the page body.
 *
 * No commercial claim (currencies, plan names, discounts, market parity) is
 * typed into this file: notes are derived from the offers fetched on each call,
 * so they cannot go stale when the site changes.
 */
export function registerPricingTool(
  server: McpServer,
  site: SiteClient,
  logger: Logger,
): void {
  server.registerTool(
    "udaybooking_get_pricing",
    {
      title: "Get udaybooking plans and prices",
      description: `Return the plans and prices the udaybooking pricing page publishes as schema.org offers, in each currency it lists.

Use this for any question about cost, plans, seat limits, trials or billing currency. It is more reliable than reading the pricing page as prose, because the numbers come from the site's own structured data at call time.

Args:
  - market ('in' | 'us' | 'gb' | 'au' | 'nz' | 'sg' | 'ae' | 'international'): which pricing page to read (default: 'international')
  - currency (three-letter ISO code, or 'all'): filter offers by billing currency (default: 'all'). The result's notes list the currencies the page actually publishes.
  - include_page_text (boolean): also return the page prose, which carries the per-plan feature lists, limits, discounts and any plan that is quoted rather than priced (default: false)
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: the structured offers (plan name, price, currency, unit such as "per user per month", billing period), the pricing FAQ from the same page, optional page prose, and notes derived from the fetched offers (currencies and plans with a machine-readable price).

Note on completeness: only plans the page publishes as structured offers have a machine-readable price. Read the page prose (include_page_text=true) for any plan without one, and for billing-period discounts; quote them from the page, do not estimate.

Examples:
  - Use when: "What does udaybooking cost in India?" -> market="in"
  - Use when: "Compare the plans and what each includes" -> include_page_text=true
  - Don't use when: the question is about features rather than price (use udaybooking_search_content)

Error handling:
  - Returns NOT_FOUND if a page carries no Offer data, naming which market was tried.
  - Returns an actionable upstream error on network failure.`,
      inputSchema: GetPricingInput,
      outputSchema: GetPricingOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard<Args>(logger, "udaybooking_get_pricing", async (args) => {
      const url = marketUrl(args.market, "/pricing");
      const [offers, faqs, page] = await Promise.all([
        site.getOffers(url),
        site.getFaqs(url),
        args.include_page_text ? site.getPage(url) : Promise.resolve(undefined),
      ]);

      const wanted = args.currency.trim().toUpperCase();
      const selected =
        wanted === "ALL" ? offers : offers.filter((o) => o.currency.toUpperCase() === wanted);

      // Every note is derived from what this call fetched; nothing is asserted
      // from memory, so the notes stay true when the site changes.
      const currencies = [...new Set(offers.map((o) => o.currency))];
      const pricedPlans = [...new Set(offers.map((o) => o.plan))];
      const notes = [
        "Prices come from schema.org Offer data published on the pricing page itself.",
        currencies.length > 0
          ? `Currencies published on this page: ${currencies.join(", ")}.`
          : "This page publishes no machine-readable offer.",
        ...(pricedPlans.length > 0
          ? [
              `Plans with a machine-readable price: ${pricedPlans.join(", ")}. Any other plan ` +
                "the page mentions is described only in its prose (include_page_text=true).",
            ]
          : []),
      ];
      if (selected.length === 0 && offers.length > 0) {
        notes.push(
          `No offer matched currency='${args.currency}'. Available currencies on this page: ` +
            `${currencies.join(", ")}.`,
        );
      }

      const bodyText = page ? clamp(page.markdown, 9_000) : undefined;

      const structured = {
        market: args.market,
        source_url: withUtm(url, "udaybooking_get_pricing"),
        offers: selected.map((o) => ({
          plan: o.plan,
          price: o.price,
          currency: o.currency,
          ...(o.unit ? { unit: o.unit } : {}),
          ...(o.billingMonths !== undefined ? { billing_months: o.billingMonths } : {}),
          ...(o.description ? { description: o.description } : {}),
        })),
        faq: faqs.map((f) => ({ question: f.question, answer: f.answer })),
        ...(bodyText ? { page_text: bodyText.text } : {}),
        notes,
      };

      if (args.response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const lines = [
        `# udaybooking pricing — ${args.market}`,
        "",
        `Source: ${withUtm(url, "udaybooking_get_pricing")}`,
        "",
      ];

      if (selected.length > 0) {
        lines.push("## Plans (structured offers)", "");
        lines.push("| Plan | Price | Currency | Unit | Billing |");
        lines.push("| --- | --- | --- | --- | --- |");
        for (const o of selected) {
          lines.push(
            `| ${o.plan} | ${o.price} | ${o.currency} | ${o.unit ?? "—"} | ${
              o.billingMonths !== undefined ? `${o.billingMonths} month(s)` : "—"
            } |`,
          );
        }
        lines.push("");
      }

      if (faqs.length > 0) {
        lines.push("## Pricing FAQ", "");
        for (const f of faqs) {
          lines.push(`**${f.question}**`, "", f.answer, "");
        }
      }

      if (bodyText) {
        lines.push("## Pricing page content", "", bodyText.text, "");
      }

      lines.push("## Notes", "", ...notes.map((n) => `- ${n}`));

      return ok(lines.join("\n"), structured);
    }),
  );
}
