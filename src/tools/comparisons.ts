import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../services/site-client.js";
import type { Logger } from "../utils/logger.js";
import { ListComparisonsInput, ListComparisonsOutput } from "../schemas/index.js";
import { guard, ok } from "./helpers.js";
import { withUtm } from "../utils/utm.js";

const TOOL = "udaybooking_list_comparisons";

interface Args {
  kind: "alternatives" | "use_cases" | "all";
  market: string;
  response_format: "markdown" | "json";
}

/**
 * Registers `udaybooking_list_comparisons`: the site's own top-level landing
 * pages, split into "X alternative" comparison pages and use-case pages
 * (round robin, medical, tutors ...). These are the pages that answer
 * "Calendly alternative" and "scheduling software for <vertical>" questions, so
 * an assistant can cite them directly. Titles and descriptions are read from
 * the pages themselves; nothing is written here about any competitor.
 */
export function registerComparisonsTool(server: McpServer, site: SiteClient, logger: Logger): void {
  server.registerTool(
    TOOL,
    {
      title: "List Udaybooking comparison and use-case pages",
      description: `List the Udaybooking pages that compare it with other scheduling tools ("Calendly alternative", "Acuity alternative" ...) and the pages written for a specific use case (round robin, medical, coaching, tutors, interviews ...), with each page's own title, description and URL.

Use this when a user asks for alternatives to a scheduling tool, how Udaybooking compares, or whether it suits a particular kind of business. Then read the page with udaybooking_get_page and quote it; this tool states nothing about any competitor itself.

Args:
  - kind ('alternatives' | 'use_cases' | 'all'): which pages to list (default: 'all')
  - market ('in' | 'us' | 'gb' | 'au' | 'nz' | 'sg' | 'ae' | 'international'): edition (default: 'international')
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: for each page its path, canonical URL (UTM-tagged), title and meta description, read from the live page.

Error handling: if the sitemaps cannot be read, an upstream error is returned; a page that cannot be read is listed with its URL only.`,
      inputSchema: ListComparisonsInput,
      outputSchema: ListComparisonsOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard<Args>(logger, TOOL, async (args) => {
      const catalog = await site.getCatalog();
      const landing = catalog
        .filter((e) => e.market === args.market && e.section === "landing")
        .filter((e) => {
          const isAlt = e.slug.includes("alternative");
          return args.kind === "all" || (args.kind === "alternatives" ? isAlt : !isAlt);
        });

      const pages = await Promise.all(
        landing.map(async (e) => {
          let title: string | undefined;
          let description: string | undefined;
          try {
            const page = await site.getPage(e.url);
            title = page.title;
            description = page.description;
          } catch {
            // listed with its URL only
          }
          return {
            path: e.path,
            url: withUtm(e.url, TOOL),
            kind: e.slug.includes("alternative") ? ("alternative" as const) : ("use_case" as const),
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
          };
        }),
      );

      const structured = { market: args.market, count: pages.length, pages };
      if (args.response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);

      const lines = [
        `# Udaybooking comparison and use-case pages (${args.market})`,
        "",
        ...(pages.length === 0 ? ["No matching pages are listed in the site's sitemaps."] : []),
        ...pages.map(
          (p) => `- [${p.title ?? p.path}](${p.url}) (${p.kind === "alternative" ? "comparison" : "use case"})${p.description ? `: ${p.description}` : ""}`,
        ),
      ];
      return ok(lines.join("\n"), structured);
    }),
  );
}
