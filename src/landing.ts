import { SITE_ORIGIN } from "./constants.js";
import { TOOL_CATALOG } from "./tool-catalog.js";

/** Display name used on the landing page and in discovery. */
export const DISPLAY_NAME = "Udaybooking MCP Server";

/**
 * The page a person sees when they open the endpoint in a browser.
 *
 * Deliberately a plain document — one column, prose, inline monospace for
 * paths, default link colours. It says what this URL is and what it will not
 * do; it is not meant to look like an app. Pure, so it can be tested.
 */
export function renderLanding(opts: { name: string; version: string; mcpPath: string }): string {
  const { name, version, mcpPath } = opts;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${DISPLAY_NAME}</title>
<meta name="robots" content="noindex">
<style>
  body {
    max-width: 47rem; margin: 0 auto; padding: 4.5rem 1.5rem 6rem;
    font: 17px/1.62 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
  }
  h1 { font-size: 2.45rem; line-height: 1.2; font-weight: 700; margin: 0 0 1.75rem; letter-spacing: -0.01em; }
  p { margin: 0 0 1.3rem; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86em;
    background: #f3f4f6; border-radius: 4px; padding: 0.1em 0.35em;
  }
  p.foot { color: #6b7280; font-size: 0.8rem; line-height: 1.55; margin-top: 1.8rem; }
</style></head>
<body>
  <h1>${DISPLAY_NAME}</h1>

  <p>The official MCP server for
  <a href="${SITE_ORIGIN}" rel="noopener noreferrer">udaybooking.com</a>. It gives AI assistants
  read-only access to Udaybooking's published documentation, guides, help centre, pricing and FAQs
  over the Streamable HTTP endpoint at <code>${mcpPath}</code>.
  No API key is required — never send one here.</p>

  <p>It does not create, change or cancel bookings, check live availability or take payments;
  people do that in Udaybooking itself. All ${TOOL_CATALOG.length} tools are public and
  read-only and hold no customer data. The server respects <code>robots.txt</code> and never requests
  <code>/api/</code>.</p>

  <p>Status: <a href="/version">/version</a> · Health: <a href="/health">/health</a> · Discovery:
  <a href="/.well-known/mcp.json">/.well-known/mcp.json</a> · Tools:
  <code>POST ${mcpPath}</code> → <code>tools/list</code></p>

  <p class="foot">${name} v${version} · official MCP server for Udaybooking.</p>
</body></html>`;
}
