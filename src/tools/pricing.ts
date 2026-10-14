import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../services/site-client.js";
import type { Logger } from "../utils/logger.js";
import { GetPricingInput, GetPricingOutput } from "../schemas/index.js";
import { clamp, guard, marketUrl, ok } from "./helpers.js";

interface Args {
  market: string;
  currency: "USD" | "INR" | "all";
  include_page_text: boolean;
  response_format: "markdown" | "json";
}

/**
 * Registers `udaybooking_get_pricing`.
 *
 * Prices come from the pricing page's `SoftwareApplication.offers` JSON-LD —
 * machine-readable data the site publishes itself — not from scraped markup.
 * The prose is offered separately because plan features, seat caps and the
 * no-platform-fee guarantees are only in the page body.
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
      description: `Return udaybooking's plans and prices, read from the machine-readable schema.org offers published on its pricing page.

Use this for any question about cost, plans, seat limits, trials or billing currency. It is more reliable than reading the pricing page as prose, because the numbers come from the site's own structured data.

Args:
  - market ('in' | 'us' | 'gb' | 'au' | 'nz' | 'sg' | 'ae' | 'international'): which pricing page to read (default: 'international')
  - currency ('USD' | 'INR' | 'all'): filter offers by billing currency (default: 'all'). udaybooking states it bills in these two currencies only, and every market's page publishes both.
  - include_page_text (boolean): also return the page prose, which carries the per-plan feature lists, seat caps and guarantees (default: false)
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: the structured offers (plan name, price, currency, unit such as "per user per month", billing period), the pricing FAQ from the same page, optional page prose, and notes recording what the site says about currency and market parity.

Note on completeness: the structured offers cover the Free and Professional plans. Enterprise is quoted rather than priced, so it carries no machine-readable offer — set include_page_text=true to read what the page says about it. Annual billing is described in the prose as 20% below the monthly rate; the structured data publishes the monthly figure.

Examples:
  - Use when: "What does udaybooking cost in India?" -> market="in", currency="INR"
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

      const selected =
        args.currency === "all" ? offers : offers.filter((o) => o.currency === args.currency);

      const notes = [
        "Prices come from schema.org Offer data published on the pricing page itself.",
        "udaybooking states the product, plans and prices are identical in every market; " +
          "the two contracted billing currencies are USD and INR.",
        "Enterprise is quoted on team size and setup, so it has no machine-readable price.",
      ];
      if (selected.length === 0) {
        notes.push(
          `No offer matched currency='${args.currency}'. Available currencies on this page: ` +
            `${[...new Set(offers.map((o) => o.currency))].join(", ")}.`,
        );
      }

      const bodyText = page ? clamp(page.markdown, 9_000) : undefined;

      const structured = {
        market: args.market,
        source_url: url,
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
        `Source: ${url}`,
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
