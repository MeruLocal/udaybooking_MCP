import { withUtm } from "../utils/utm.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SearchIndex } from "../services/search-index.js";
import type { Logger } from "../utils/logger.js";
import { SearchContentInput, SearchContentOutput } from "../schemas/index.js";
import { INDEXED_SECTIONS } from "../services/search-index.js";
import { bullets, guard, ok } from "./helpers.js";

interface Args {
  query: string;
  market: string;
  sections?: string[];
  limit: number;
  response_format: "markdown" | "json";
}

/**
 * Registers `udaybooking_search_content`.
 *
 * Search is local by necessity: the site publishes no search endpoint, and the
 * only plausible location for one is under /api/, which robots.txt disallows.
 */
export function registerSearchTool(
  server: McpServer,
  search: SearchIndex,
  logger: Logger,
): void {
  server.registerTool(
    "udaybooking_search_content",
    {
      title: "Search udaybooking documentation and marketing pages",
      description: `Full-text search across the published pages of udaybooking.com — documentation, guides, help centre, blog, product, solutions, pricing, integrations and security.

Use this first when a question is about how udaybooking works. It finds the right page and returns scored excerpts, so you can then read the whole page with udaybooking_get_page.

How it works: udaybooking.com publishes no search API (the only candidate path, /api/, is disallowed by its robots.txt), so this tool builds a local index by fetching the pages listed in the site's own sitemaps. The first call for a given market warms that index — expect a few seconds — and later calls are served from cache.

Args:
  - query (string): free-text query, 2-200 characters, e.g. "round robin fair rotation" or "reduce no-shows reminder timing"
  - market ('in' | 'us' | 'gb' | 'au' | 'nz' | 'sg' | 'ae' | 'international'): which edition to search (default: 'international'). Content is near-identical across markets; pick a country only when the question is about that market's wording or currency.
  - sections (string[]): optional filter, any of ${INDEXED_SECTIONS.join(", ")}
  - limit (number): maximum results, 1-25 (default: 8)
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: ranked pages with title, URL, path, section, relevance score and up to two text excerpts around the matched terms. Also reports how many pages were indexed and any catalogue paths that could not be fetched, so partial results are never silently presented as complete.

Examples:
  - Use when: "How does round robin assign hosts?" -> query="round robin host assignment"
  - Use when: "Which reminder channels are supported?" -> query="reminder channels whatsapp sms email", sections=["docs"]
  - Don't use when: you already know the exact path (use udaybooking_get_page), or you want plan prices (use udaybooking_get_pricing)

Error handling:
  - Returns a "no results" message naming the index size when nothing matches; try fewer or broader terms.
  - Returns an actionable upstream error if the sitemaps cannot be reached.`,
      inputSchema: SearchContentInput,
      outputSchema: SearchContentOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard<Args>(logger, "udaybooking_search_content", async (args) => {
      const { hits, indexedPages, failedPaths } = await search.search(
        args.query,
        args.market,
        args.sections,
        args.limit,
      );

      const structured = {
        query: args.query,
        market: args.market,
        count: hits.length,
        indexed_pages: indexedPages,
        results: hits.map((h) => ({
          title: h.title,
          url: withUtm(h.url, "udaybooking_search_content"),
          path: h.path,
          section: h.section,
          score: h.score,
          snippets: h.snippets,
        })),
        unavailable_paths: failedPaths,
      };

      if (hits.length === 0) {
        const text =
          `No pages in the '${args.market}' edition matched "${args.query}" ` +
          `(searched ${indexedPages} pages). Try broader or fewer terms, drop the ` +
          `sections filter, or check udaybooking_list_pages for what exists.`;
        return ok(text, structured);
      }

      if (args.response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const lines = [
        `# Search results for "${args.query}"`,
        "",
        `Market: \`${args.market}\` · ${hits.length} of ${indexedPages} indexed pages matched.`,
        "",
      ];

      for (const hit of hits) {
        lines.push(`## ${hit.title}`);
        lines.push(
          bullets([
            ["Path", `\`${hit.path}\``],
            ["Section", hit.section],
            ["Score", hit.score],
          ]),
        );
        for (const snippet of hit.snippets) lines.push(`> ${snippet}`);
        lines.push(`Read in full: \`udaybooking_get_page\` with path \`${hit.path}\``);
        lines.push("");
      }

      if (failedPaths.length > 0) {
        lines.push(
          `_Note: ${failedPaths.length} catalogue page(s) could not be fetched and are absent from this index: ${failedPaths
            .slice(0, 8)
            .join(", ")}._`,
        );
      }

      return ok(lines.join("\n"), structured);
    }),
  );
}
