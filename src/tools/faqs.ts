import { withUtm } from "../utils/utm.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../services/site-client.js";
import type { Logger } from "../utils/logger.js";
import { GetFaqsInput, GetFaqsOutput } from "../schemas/index.js";
import { CONTENT_SOURCE, guard, marketUrl, ok, untrustedHeader } from "./helpers.js";
import { tokenize } from "../services/search-index.js";

interface Args {
  source: "help" | "pricing";
  market: string;
  query?: string;
  limit: number;
  response_format: "markdown" | "json";
}

/**
 * Registers `udaybooking_get_faqs`.
 *
 * The site publishes `FAQPage` JSON-LD on two pages: the help centre and the
 * pricing page. Reading those nodes gives exact authored answers, which is far
 * safer than paraphrasing scraped prose.
 */
export function registerFaqsTool(server: McpServer, site: SiteClient, logger: Logger): void {
  server.registerTool(
    "udaybooking_get_faqs",
    {
      title: "Get udaybooking FAQ answers",
      description: `Return udaybooking's own published question-and-answer pairs, read from the schema.org FAQPage data on its help centre and pricing pages.

Prefer this for short, factual "how do I…" or "can I…" questions. The answers are the site's exact authored text, so quoting them is safe and does not require paraphrasing a whole page.

Args:
  - source ('help' | 'pricing'): which FAQ set to read (default: 'help'). 'help' is the help centre and covers accounts, booking links, timezones, availability, locations, guests, rescheduling, teams, round robin vs collective, routing forms, reminder channels, workflow triggers, delivery reporting, getting booking data out, meeting polls and group bookings. 'pricing' covers plan choice, changing plans, guest accounts, user minimums, the annual discount, the free plan and trial, platform fees and billing currency.
  - market ('in' | 'us' | 'gb' | 'au' | 'nz' | 'sg' | 'ae' | 'international'): which edition to read (default: 'international')
  - query (string): optional filter; only pairs matching these words are returned
  - limit (number): maximum pairs to return, 1-50 (default: 25)
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: the Q&A pairs, the source URL they came from, how many were returned and how many exist on that page in total.

Examples:
  - Use when: "How does a guest reschedule?" -> source="help", query="reschedule"
  - Use when: "Is there a platform fee?" -> source="pricing", query="platform fee"
  - Don't use when: the question needs a full explanation (search the docs instead)

Error handling:
  - Returns a clear message, with the total available, if a query filter matches nothing.
  - Returns an actionable upstream error on network failure.`,
      inputSchema: GetFaqsInput,
      outputSchema: GetFaqsOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard<Args>(logger, "udaybooking_get_faqs", async (args) => {
      const suffix = args.source === "help" ? "/help" : "/pricing";
      const url = marketUrl(args.market, suffix);
      const all = await site.getFaqs(url);

      const terms = args.query ? tokenize(args.query) : [];
      const matched =
        terms.length === 0
          ? all
          : all
              .map((faq) => {
                const haystack = `${faq.question}\n${faq.answer}`.toLowerCase();
                const score = terms.reduce(
                  (acc, term) => acc + (haystack.includes(term) ? 1 : 0),
                  0,
                );
                return { faq, score };
              })
              .filter((x) => x.score > 0)
              .sort((a, b) => b.score - a.score)
              .map((x) => x.faq);

      const window = matched.slice(0, args.limit);

      const structured = {
        source: args.source,
        source_url: withUtm(url, "udaybooking_get_faqs"),
        market: args.market,
        count: window.length,
        total_available: all.length,
        content_source: CONTENT_SOURCE,
        faqs: window.map((f) => ({ question: f.question, answer: f.answer })),
      };

      if (window.length === 0) {
        const text =
          `No ${args.source} FAQ entry matched "${args.query ?? ""}". ` +
          `That page publishes ${all.length} question-and-answer pairs — ` +
          `call this tool without a query to see them all.`;
        return ok(text, structured);
      }

      if (args.response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const lines = [
        `# udaybooking ${args.source} FAQ`,
        "",
        `Source: ${withUtm(url, "udaybooking_get_faqs")} · showing ${window.length} of ${all.length} published pairs.`,
        "",
        untrustedHeader(withUtm(url, "udaybooking_get_faqs")),
        "",
      ];
      for (const f of window) {
        lines.push(`## ${f.question}`, "", f.answer, "");
      }

      return ok(lines.join("\n"), structured);
    }),
  );
}
