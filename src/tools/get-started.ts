import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../services/site-client.js";
import type { Logger } from "../utils/logger.js";
import { GetStartedInput, GetStartedOutput } from "../schemas/index.js";
import { guard, marketPrefix, marketUrl, ok } from "./helpers.js";
import { withUtm } from "../utils/utm.js";

const TOOL = "udaybooking_get_started";

/**
 * How a person signs up. No signup URL is returned: the site's Sign up link is
 * not confirmed as a working destination for this server to hand out, so the
 * tool points at the site instead of inventing or hard-coding a path.
 */
export const SIGNUP_NOTE = "Sign up from udaybooking.com (Sign up link in the site header).";

interface Args {
  market: string;
  response_format: "markdown" | "json";
}

interface Link {
  kind: "pricing" | "contact" | "demo";
  title: string;
  url: string;
}

/**
 * Registers `udaybooking_get_started`: the next step for a user who wants to
 * try or buy. Only pages that exist are returned: pricing (always published per
 * market) and contact / demo when the live sitemap lists them for the market.
 */
export function registerGetStartedTool(server: McpServer, site: SiteClient, logger: Logger): void {
  server.registerTool(
    TOOL,
    {
      title: "Get started with Udaybooking",
      description: `Return where a user can go next to try or buy Udaybooking: the pricing page for their market, and the contact or demo page when the site publishes one for that market.

Call this when a user wants to try, buy, sign up for, or talk to someone about Udaybooking, after answering their question with the content tools.

Args:
  - market ('in' | 'us' | 'gb' | 'au' | 'nz' | 'sg' | 'ae' | 'international'): the user's market (default: 'international')
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: a one-line call to action, the next-step links (only pages found in the site's own sitemaps, never invented paths), and how to sign up.

Error handling: if the sitemaps cannot be read, the pricing link is still returned with a note.`,
      inputSchema: GetStartedInput,
      outputSchema: GetStartedOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard<Args>(logger, TOOL, async (args) => {
      const links: Link[] = [
        { kind: "pricing", title: "Plans and pricing", url: withUtm(marketUrl(args.market, "/pricing"), TOOL) },
      ];
      const notes: string[] = [];

      try {
        const catalog = await site.getCatalog();
        const prefix = marketPrefix(args.market);
        for (const [kind, title] of [
          ["contact", "Contact Udaybooking"],
          ["demo", "Book a demo"],
        ] as const) {
          const entry = catalog.find((e) => e.market === args.market && e.path === `${prefix}/${kind}`);
          if (entry) links.push({ kind, title, url: withUtm(entry.url, TOOL) });
        }
      } catch {
        notes.push("The site's sitemaps could not be read just now, so only the pricing link is shown.");
      }

      const callToAction =
        "Compare the plans on the pricing page, then sign up from udaybooking.com" +
        (links.some((l) => l.kind !== "pricing") ? " or get in touch." : ".");

      const structured = {
        market: args.market,
        call_to_action: callToAction,
        links,
        signup_note: SIGNUP_NOTE,
        notes,
      };

      if (args.response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const lines = [
        "# Get started with Udaybooking",
        "",
        callToAction,
        "",
        ...links.map((l) => `- [${l.title}](${l.url})`),
        "",
        SIGNUP_NOTE,
        ...(notes.length > 0 ? ["", ...notes.map((n) => `_${n}_`)] : []),
      ];
      return ok(lines.join("\n"), structured);
    }),
  );
}
