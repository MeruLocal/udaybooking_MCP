# Udaybooking MCP Server

The official MCP server for [udaybooking.com](https://udaybooking.com). It gives
AI assistants (Claude Desktop, Claude Code and any MCP client) read-only access
to Udaybooking's published documentation, guides, help centre, pricing and FAQs.

- **Read-only.** It does not create, change or cancel bookings, check live
  availability or take payments; people do that in Udaybooking itself.
- **No API key.** It reads public pages only and holds no credentials.
- **Polite.** It respects `robots.txt` (never requests `/api/`), spaces its
  requests, and caches pages and its search index.
- **Two transports.** stdio (`dist/index.js`) and Streamable HTTP
  (`dist/http.js`, planned public endpoint `https://mcp.udaybooking.com/mcp`).

## Tools

`tools/list` is the source of truth; this table is a summary.

| Tool | What it returns |
| --- | --- |
| `udaybooking_search_content` | Full-text search across published docs, guides, help centre and blog |
| `udaybooking_get_page` | One page as Markdown, with metadata and schema.org data |
| `udaybooking_list_pages` | Published pages from the site's sitemaps, by market and section |
| `udaybooking_get_pricing` | Plans and prices from the pricing page's schema.org offers |
| `udaybooking_get_faqs` | Published Q&A pairs from the help centre and pricing FAQ |
| `udaybooking_list_markets` | The country editions of the site, plus the international one |
| `udaybooking_get_site_summary` | The site's own `/llms.txt` summary |
| `udaybooking_get_automation_capabilities` | What this server can and cannot do, and why |

Resources: `udaybooking://capabilities` and `udaybooking://llms.txt`.

## Run

Requires Node.js 20.10 or newer.

```bash
npm ci
npm run build
npm test
```

**stdio (Claude Desktop).** Add to `claude_desktop_config.json`, with an
absolute path:

```json
{
  "mcpServers": {
    "udaybooking": { "command": "node", "args": ["/path/to/udaybooking_MCP/dist/index.js"] }
  }
}
```

**Claude Code:** `claude mcp add udaybooking -- node /path/to/udaybooking_MCP/dist/index.js`

**HTTP:** `npm run start:http` listens on `127.0.0.1:3004`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` / `GET` / `DELETE` | `/mcp` | MCP Streamable HTTP endpoint |
| `GET` | `/` | Landing page (also served to a browser visiting `/mcp`) |
| `GET` | `/version` | Server and protocol version, endpoint, tool count |
| `GET` | `/.well-known/mcp.json` | Discovery document |
| `GET` | `/health` | Liveness, sessions, cache stats |

`npm run smoke:http` checks a running server end to end; `npm run inspect`
opens the MCP Inspector over stdio.

## Configuration

Every setting has a safe default; see `.env.example` for the full list. The
common ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `UDAYBOOKING_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent` (stderr only) |
| `UDAYBOOKING_MAX_CONCURRENCY` | `2` | In-flight requests to udaybooking.com |
| `UDAYBOOKING_MIN_REQUEST_INTERVAL_MS` | `250` | Gap between upstream requests |
| `UDAYBOOKING_CACHE_TTL_MS` | `900000` | Page cache lifetime |
| `UDAYBOOKING_MAX_RESPONSE_BYTES` | `5000000` | Largest upstream body read |
| `UDAYBOOKING_HTTP_PORT` / `PORT` | `3004` | HTTP port |
| `UDAYBOOKING_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `UDAYBOOKING_HTTP_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1],mcp.udaybooking.com` | `Host` names answered |
| `UDAYBOOKING_HTTP_RATE_LIMIT_PER_MIN` | `60` | Requests per minute per client IP (`0` disables) |
| `UDAYBOOKING_HTTP_MAX_SESSIONS` | `100` | Concurrent HTTP sessions |
| `TRUST_PROXY` | `0` | Use the right-most `X-Forwarded-For` hop as the client IP |
| `PUBLIC_BASE_URL` | unset | URL advertised by discovery |

## Security

- Upstream fetches are pinned to `udaybooking.com` and `www.udaybooking.com`
  (plus the configured `UDAYBOOKING_BASE_URL` host). Redirects are followed one
  hop at a time and every hop is checked before it is requested.
- The HTTP transport answers only allowlisted `Host` names, rate-limits each
  client IP (`429` + `Retry-After`; `/health` exempt), caps sessions (`503`),
  rejects foreign browser `Origin`s (`403`) and caps request bodies at 1 MB.
- The discovery URL comes from `PUBLIC_BASE_URL`, never from `X-Forwarded-*`.

## Deploy (Docker)

```bash
docker build -t udaybooking-mcp .
docker run --rm -p 127.0.0.1:3004:3004 udaybooking-mcp
```

The image runs the HTTP transport as a non-root user and binds `0.0.0.0`
inside the container. It needs outbound HTTPS to udaybooking.com. Behind
Cloudflare and Apache, set `PUBLIC_BASE_URL=https://mcp.udaybooking.com` and
`TRUST_PROXY=1`, and keep Apache's `ProxyPreserveHost On` so the `Host` header
stays on the allowlist.

## Project layout

```
src/
  index.ts / http.ts     stdio and Streamable HTTP entry points
  server.ts              builds the McpServer: tools, resources, instructions
  landing.ts             the HTML landing page
  capabilities.ts        what the server can and cannot do
  config.ts              environment configuration (Zod)
  services/              HTTP client, site client, search index, HTTP policy, rate limit
  tools/                 one file per tool group
  utils/                 HTML parsing, errors, logging, cache
tests/                   unit and end-to-end tests (no network)
scripts/                 smoke checks and the version check
server.json              MCP Registry metadata
```

## License

MIT
