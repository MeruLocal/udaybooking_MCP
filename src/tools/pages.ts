import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../services/site-client.js";
import type { Logger } from "../utils/logger.js";
import { GetPageInput, GetPageOutput, ListPagesInput, ListPagesOutput } from "../schemas/index.js";
import { bullets, clamp, guard, ok } from "./helpers.js";
import { notFound } from "../utils/errors.js";

interface GetPageArgs {
  path: string;
  max_chars: number;
  include_json_ld: boolean;
  response_format: "markdown" | "json";
}

interface ListPagesArgs {
  market?: string;
  section?: string;
  limit: number;
  offset: number;
  response_format: "markdown" | "json";
}

/** Registers `udaybooking_get_page`. */
export function registerGetPageTool(
  server: McpServer,
  site: SiteClient,
  logger: Logger,
): void {
  server.registerTool(
    "udaybooking_get_page",
    {
      title: "Read one udaybooking.com page",
      description: `Fetch a single published page from udaybooking.com and return its readable content as Markdown, plus its metadata and schema.org data.

Use this to read a page end to end once udaybooking_search_content or udaybooking_list_pages has identified it — for example a documentation page, a guide, a blog post or a legal page.

Args:
  - path (string): site-relative path such as '/in/docs/availability' or '/guides/round-robin-sales', or a full https://udaybooking.com/... URL. Market-prefixed paths put the market first ('/in/docs/...'), not last.
  - max_chars (number): body budget, 500-25000 (default: 12000). Longer pages are truncated with an explicit note.
  - include_json_ld (boolean): also return the raw schema.org nodes (default: false). Useful for exact dates, breadcrumbs or offers.
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: url, path, market, section, title, meta description, locale, breadcrumb trail, publication and modification dates where the page is an article, and the body content. Flags whether the body was truncated and reports the original length.

Examples:
  - Use when: "What does the availability doc say about booking windows?" -> path="/docs/availability"
  - Use when: "Read the India pricing page" -> path="/in/pricing"
  - Don't use when: you want only plan prices (udaybooking_get_pricing returns them structured), or you do not yet know the path (search first)

Error handling:
  - Returns NOT_FOUND with a pointer to udaybooking_list_pages for a 404, which usually means a mis-ordered market prefix.
  - Refuses any path under '/api/' (DISALLOWED_PATH): udaybooking.com's robots.txt disallows it for all user agents.
  - Refuses any host other than udaybooking.com.`,
      inputSchema: GetPageInput,
      outputSchema: GetPageOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard<GetPageArgs>(logger, "udaybooking_get_page", async (args) => {
      const page = await site.getPage(args.path);
      const body = clamp(page.markdown, args.max_chars);

      const structured = {
        url: page.url,
        path: page.path,
        market: page.market,
        section: page.section,
        ...(page.title ? { title: page.title } : {}),
        ...(page.description ? { description: page.description } : {}),
        ...(page.locale ? { locale: page.locale } : {}),
        breadcrumbs: page.breadcrumbs,
        ...(page.datePublished ? { date_published: page.datePublished } : {}),
        ...(page.dateModified ? { date_modified: page.dateModified } : {}),
        content: body.text,
        truncated: body.truncated,
        original_length: body.originalLength,
        ...(args.include_json_ld ? { json_ld: page.jsonLdNodes } : {}),
      };

      if (args.response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const lines = [
        `# ${page.title ?? page.path}`,
        "",
        bullets([
          ["URL", page.url],
          ["Market", page.market],
          ["Section", page.section],
          ["Description", page.description],
          ["Breadcrumbs", page.breadcrumbs.length > 0 ? page.breadcrumbs.join(" › ") : undefined],
          ["Published", page.datePublished],
          ["Modified", page.dateModified],
        ]),
        "",
        "---",
        "",
        body.text,
      ];

      if (args.include_json_ld && page.jsonLdNodes.length > 0) {
        lines.push("", "---", "", "## schema.org JSON-LD", "", "```json");
        lines.push(JSON.stringify(page.jsonLdNodes, null, 2));
        lines.push("```");
      }

      return ok(lines.join("\n"), structured);
    }),
  );
}

/** Registers `udaybooking_list_pages`. */
export function registerListPagesTool(
  server: McpServer,
  site: SiteClient,
  logger: Logger,
): void {
  server.registerTool(
    "udaybooking_list_pages",
    {
      title: "List udaybooking.com pages from its sitemaps",
      description: `List the pages udaybooking.com publishes, read from its own sitemap index (/sitemap.xml and the three child sitemaps it points at).

Use this to discover what exists before fetching anything, to find the exact path for a page, or to enumerate a section such as all documentation pages.

Args:
  - market ('in' | 'us' | 'gb' | 'au' | 'nz' | 'sg' | 'ae' | 'international'): filter to one edition. Omit for all.
  - section (string): filter to one section — home, product, solutions, docs, guides, blog, help, resources, pricing, integrations, security, how-it-works, company, legal. Omit for all.
  - limit (number): maximum entries, 1-200 (default: 60)
  - offset (number): entries to skip, for pagination (default: 0)
  - response_format ('markdown' | 'json'): output shape (default: 'markdown')

Returns: total matching count, the page window requested, and for each entry its path, absolute URL, market, section, slug, and the sitemap's own changefreq and priority. Includes has_more and next_offset for paging.

Examples:
  - Use when: "What documentation pages exist?" -> section="docs", market="international"
  - Use when: "List the India market pages" -> market="in"
  - Don't use when: you want page content (use udaybooking_get_page) or are searching by topic (use udaybooking_search_content)

Error handling:
  - Returns an actionable upstream error if the sitemaps are unreachable; the site intermittently drops connections and retries usually succeed.
  - Returns an empty list with the filters echoed back when nothing matches.`,
      inputSchema: ListPagesInput,
      outputSchema: ListPagesOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard<ListPagesArgs>(logger, "udaybooking_list_pages", async (args) => {
      const { entries: catalog, failures } = await site.getCatalogResult();
      const filtered = catalog.filter(
        (entry) =>
          (args.market === undefined || entry.market === args.market) &&
          (args.section === undefined || entry.section === args.section),
      );

      if (filtered.length === 0) {
        // Distinguish "genuinely absent" from "we could not read that sitemap",
        // so an incomplete catalogue is never reported as an empty one.
        const hint =
          failures.length > 0
            ? `Note: ${failures.length} of the site's sitemaps could not be read on this attempt, ` +
              `so the catalogue is incomplete (${catalog.length} pages loaded). Retry — the next ` +
              `call re-fetches the missing sitemaps. Failures: ${failures.join("; ")}`
            : `The catalogue holds ${catalog.length} pages. Drop a filter, or call this tool with ` +
              `no arguments to see what exists.`;
        throw notFound(
          `No pages match market='${args.market ?? "any"}' and section='${args.section ?? "any"}'.`,
          hint,
        );
      }

      const window = filtered.slice(args.offset, args.offset + args.limit);
      const hasMore = args.offset + window.length < filtered.length;

      const structured = {
        total: filtered.length,
        count: window.length,
        offset: args.offset,
        has_more: hasMore,
        ...(hasMore ? { next_offset: args.offset + window.length } : {}),
        pages: window.map((entry) => ({
          path: entry.path,
          url: entry.url,
          market: entry.market,
          section: entry.section,
          slug: entry.slug,
          ...(entry.changeFrequency ? { change_frequency: entry.changeFrequency } : {}),
          ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
        })),
      };

      if (args.response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const lines = [
        "# udaybooking.com pages",
        "",
        `Showing ${window.length} of ${filtered.length} matching pages` +
          `${args.market ? ` · market \`${args.market}\`` : ""}` +
          `${args.section ? ` · section \`${args.section}\`` : ""}.`,
        "",
      ];

      let current = "";
      for (const entry of window) {
        const group = `${entry.market}/${entry.section}`;
        if (group !== current) {
          current = group;
          lines.push(`### ${entry.market} — ${entry.section}`);
        }
        lines.push(`- \`${entry.path}\``);
      }

      if (hasMore) {
        lines.push("", `_More available — call again with offset=${args.offset + window.length}._`);
      }
      if (failures.length > 0) {
        lines.push(
          "",
          `_Warning: the catalogue is incomplete — ${failures.length} sitemap(s) could not be read ` +
            `on this attempt. Retry to pick up the missing pages._`,
        );
      }

      return ok(lines.join("\n"), structured);
    }),
  );
}
