# udaybooking-mcp-server

An MCP server that lets Claude Desktop and Claude Code read and search the public
content of [udaybooking.com](https://udaybooking.com) — its documentation, guides,
help centre, blog, plan prices and FAQs. Runs over **stdio** for local clients, or
**Streamable HTTP** on a port (3004 by default) for remote and multi-client use.

**It is read-only, and it cannot make bookings.** That is not a limitation of this
implementation; it is what the site actually supports. The analysis behind that
statement, and exactly what would be needed to change it, is in
[Verified site functionality](#1-verified-site-functionality) and
[What needs more access](#12-what-needs-further-documentation-or-access).

---

## Contents

1. [Verified site functionality](#1-verified-site-functionality)
2. [Tools](#2-tools)
3. [Install and build](#3-install-and-build)
4. [Configure in Claude Desktop](#4-configure-in-claude-desktop)
4a. [Run over HTTP on a port](#4a-run-over-http-on-a-port)
5. [Use with Claude Code](#5-use-with-claude-code)
6. [Example requests](#6-example-requests)
7. [Testing](#7-testing)
8. [Troubleshooting](#8-troubleshooting)
9. [Authentication and restrictions](#9-authentication-and-restrictions)
10. [Design decisions](#10-design-decisions)
11. [Project layout](#11-project-layout)
12. [What needs further documentation or access](#12-what-needs-further-documentation-or-access)

---

## 1. Verified site functionality

Everything below was observed in live responses on **2026-10-13**. Nothing is
inferred from marketing copy, and no endpoint has been invented.

### What udaybooking is

A scheduling and appointment product in the same category as Calendly: a host
publishes a booking link, guests pick a time from live availability, and the
meeting lands on both calendars. Features described across the site include
booking types, availability rules and booking windows, two-way Google Calendar
and Outlook/Microsoft 365 sync, Zoom and Google Meet locations, team scheduling
(round robin, collective, group), meeting polls, routing forms, workflows, and
reminders over WhatsApp, SMS and email.

### What `udaybooking.com` actually serves

A **prerendered Next.js marketing and documentation site** — and only that.
Responses carry `x-nextjs-prerender: 1`, so every page is complete server-rendered
HTML.

- **417 URLs** across a sitemap index (`/sitemap.xml`) and three child sitemaps
  (`/sitemaps/pages.xml`, `/sitemaps/markets.xml`, `/sitemaps/resources.xml`).
- **Seven country editions** (`/in`, `/us`, `/gb`, `/au`, `/nz`, `/sg`, `/ae`)
  plus an unprefixed international edition. The site states the product, plans and
  prices are identical in all of them.
- **Rich, genuinely useful JSON-LD** on every page, which this server reads rather
  than scraping markup:
  - `SoftwareApplication.offers` on pricing pages (Free and Professional, in USD
    and INR, with `UnitPriceSpecification`)
  - `FAQPage` — 22 question/answer pairs on `/help`, 9 on `/pricing`
  - `TechArticle` on documentation, `BlogPosting` with `datePublished` on posts
  - `BreadcrumbList` site-wide, `Organization` / `WebSite` on every page
- **`/llms.txt`** — a machine-readable site summary the site publishes for language
  models, covering the product, prices, the full documentation index and common
  questions.

### What it does not serve

| Claim | Finding |
| --- | --- |
| A public API | **None published.** No base URL, no auth scheme, no schemas anywhere on the site. |
| `/api/` endpoints | **Disallowed by `robots.txt`** for every user agent, including `ClaudeBot`, `Claude-User` and `Claude-SearchBot`: `Allow: /` with `Disallow: /api/`. |
| A reachable product app | **No.** Every *Log in* and *Sign up* link points at `https://app.udaybooking.com`, which returns a **byte-identical 46,784-byte SPA shell titled `HelloGrowthCRM`** for `/`, `/login`, `/signup`, `/api/v1/bookings` and arbitrary nonsense paths. It does not serve udaybooking. |
| A real booking page | **No.** The booking widget on the homepage is labelled *"Interactive preview"* in the page itself, and the link it displays (`udaybooking.com/alex/consultation`) does not resolve. |
| "Agent endpoints" | **Advertised, not specified.** `/integrations` lists *"Agent endpoints — Book programmatically from your own app"*, and `/docs/workflows` and `/help` repeat it in prose, but no base URL, authentication method or schema is published anywhere. |
| Webhooks | **Advertised, not specified.** Configured inside the product app; no management API is documented. |

**Consequence for this project:** `create_booking`, `cancel_booking`,
`list_my_bookings`, `check_availability` and `get_service_details` are **not
implemented**, because there is nothing to call. Implementing them would mean
fabricating endpoints and, worse, risking a false "your booking is confirmed".
The server instead ships `udaybooking_get_automation_capabilities`, which reports
this truthfully so a model does not promise what the platform cannot do.

---

## 2. Tools

Eight tools, all read-only (`readOnlyHint: true`, `destructiveHint: false`), all
with a structured `outputSchema`. There are no state-changing tools.

### `udaybooking_search_content`

Full-text search across published pages. Builds a local index on first use —
udaybooking.com has no search endpoint, and the only candidate path is
robots-disallowed.

| Input | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string, 2–200 chars | *required* | Free text |
| `market` | market code | `international` | `in`/`us`/`gb`/`au`/`nz`/`sg`/`ae`/`international` |
| `sections` | string[] | all | `docs`, `guides`, `help`, `pricing`, `product`, `how-it-works`, `integrations`, `solutions`, `security`, `blog`, `home`, `resources` |
| `limit` | 1–25 | `8` | |
| `response_format` | `markdown`\|`json` | `markdown` | |

**Output:** `query`, `market`, `count`, `indexed_pages`, `results[{title, url,
path, section, score, snippets[]}]`, `unavailable_paths[]`.

### `udaybooking_get_page`

Reads one page as Markdown, scoped to its `<main>` landmark with navbar, sidebar
and footer removed.

| Input | Type | Default |
| --- | --- | --- |
| `path` | string — `/in/docs/availability`, or a full `https://udaybooking.com/...` URL | *required* |
| `max_chars` | 500–25000 | `12000` |
| `include_json_ld` | boolean | `false` |
| `response_format` | `markdown`\|`json` | `markdown` |

**Output:** `url`, `path`, `market`, `section`, `title?`, `description?`,
`locale?`, `breadcrumbs[]`, `date_published?`, `date_modified?`, `content`,
`truncated`, `original_length`, `json_ld?`.

### `udaybooking_list_pages`

The page catalogue from the site's own sitemaps.

| Input | Type | Default |
| --- | --- | --- |
| `market` | market code | all |
| `section` | section | all |
| `limit` | 1–200 | `60` |
| `offset` | ≥0 | `0` |
| `response_format` | `markdown`\|`json` | `markdown` |

**Output:** `total`, `count`, `offset`, `has_more`, `next_offset?`,
`pages[{path, url, market, section, slug, change_frequency?, priority?}]`.

### `udaybooking_get_pricing`

Plans and prices from `SoftwareApplication.offers` JSON-LD — the site's own
structured data, not scraped text.

| Input | Type | Default |
| --- | --- | --- |
| `market` | market code | `international` |
| `currency` | `USD`\|`INR`\|`all` | `all` |
| `include_page_text` | boolean | `false` |
| `response_format` | `markdown`\|`json` | `markdown` |

**Output:** `market`, `source_url`, `offers[{plan, price, currency, unit?,
billing_months?, description?}]`, `faq[{question, answer}]`, `page_text?`,
`notes[]`.

> **Completeness:** Free and Professional carry machine-readable offers.
> **Enterprise is quoted, so it has no structured price** — pass
> `include_page_text: true` to read what the page says about it. The structured
> data publishes the monthly rate; the 20% annual discount is described in prose.

### `udaybooking_get_faqs`

Exact authored Q&A from `FAQPage` JSON-LD.

| Input | Type | Default |
| --- | --- | --- |
| `source` | `help` (22 pairs) \| `pricing` (9 pairs) | `help` |
| `market` | market code | `international` |
| `query` | string, 2–200 chars | none |
| `limit` | 1–50 | `25` |
| `response_format` | `markdown`\|`json` | `markdown` |

**Output:** `source`, `source_url`, `market`, `count`, `total_available`,
`faqs[{question, answer}]`.

### `udaybooking_list_markets`

The seven country editions plus `international`. No network request.

**Output:** `count`, `markets[{code, name, locale, path_prefix, home_url}]`,
`notes[]`.

### `udaybooking_get_site_summary`

Fetches `/llms.txt`. The cheapest way to get oriented — one request returns the
product overview, prices, documentation index and common questions.

**Output:** `source_url`, `content`, `truncated`.

### `udaybooking_get_automation_capabilities`

Reports what this server can and cannot do, with the evidence. No network
request. **Call this before telling anyone udaybooking can or cannot be
automated**, and whenever a request involves creating, changing, paying for or
cancelling a booking.

**Output:** `verified_at`, `public_api_available`, `browser_automation_used`,
`supported[{capability, detail}]`, `not_supported[{capability, reason,
what_would_unblock_it}]`, `evidence[]`.

### Resources

| URI | Contents |
| --- | --- |
| `udaybooking://capabilities` | The capability report as Markdown |
| `udaybooking://llms.txt` | The site's machine-readable summary |

---

## 3. Install and build

Requires **Node.js 20.10 or newer** (the server uses built-in `fetch`).

```bash
npm install
npm run build
```

Optional configuration — the server runs fine without it:

```bash
cp .env.example .env
```

Verify the build:

```bash
npm test
```

Inspect it interactively with the MCP Inspector:

```bash
npm run inspect
```

---

## 4. Configure in Claude Desktop

Edit the config file:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Add the server, using an **absolute path** to `dist/index.js`:

```json
{
  "mcpServers": {
    "udaybooking": {
      "command": "node",
      "args": ["C:\\Users\\you\\path\\to\\udaybooking-mcp-server\\dist\\index.js"],
      "env": {
        "UDAYBOOKING_LOG_LEVEL": "info"
      }
    }
  }
}
```

On macOS or Linux the path is of the form
`/Users/you/path/to/udaybooking-mcp-server/dist/index.js`.

Restart Claude Desktop completely, then confirm the eight `udaybooking_*` tools
appear in the tools menu.

---

## 4a. Run over HTTP on a port

There are two transports. **stdio** (`dist/index.js`) is the default and what
Claude Desktop launches as a subprocess. **Streamable HTTP** (`dist/http.js`)
serves the same eight tools on a TCP port, for remote deployment, containers,
multiple concurrent clients, or inspecting the server with HTTP tooling.

```bash
npm run build
npm run start:http        # http://127.0.0.1:3004/mcp
```

Different port:

```bash
UDAYBOOKING_HTTP_PORT=8080 npm run start:http
```

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/mcp` | JSON-RPC requests — `initialize`, `tools/list`, `tools/call`, … |
| `GET` | `/mcp` | SSE stream for server-initiated notifications |
| `DELETE` | `/mcp` | Terminate a session |
| `GET` | `/` | Landing page — the same page a browser visit to `/mcp` serves |
| `GET` | `/version` | Server and protocol version, transport, and the tool list |
| `GET` | `/.well-known/mcp.json` | Discovery document: transport, auth, tools, resources |
| `GET` | `/health` | Liveness, session count, cache stats — for a proxy or container probe |

Opening `/mcp` in a browser serves a plain landing page explaining what the
endpoint is, matching the house style used across the other MCP servers in this
estate (HelloGrowthCRM, RaivatEdu, Hemmiles): heading, lead paragraph, a
`Status · Discovery · Tools` line, fine print, body paragraphs, a closing
`Status · Health` line, and a footer naming the server version and stating it is
unofficial and unaffiliated. The page is detected via `Sec-Fetch-Mode: navigate`,
so an MCP client's `GET` still reaches the transport.

`/version` and `/.well-known/mcp.json` both advertise the tool list from
`src/tool-catalog.ts`. The MCP SDK exposes no public API for enumerating a
server's registered tools, so that list is declared — and `tests/server.test.ts`
asserts it matches what a real client sees from `tools/list`, which is what stops
it drifting.

```bash
curl -s http://127.0.0.1:3004/health
```

```json
{
  "status": "ok",
  "server": "udaybooking-mcp-server",
  "version": "1.0.0",
  "transport": "streamable-http",
  "endpoint": "/mcp",
  "sessions": 0,
  "sessionIdleTtlMs": 1800000,
  "cachedPages": 12,
  "indexedMarkets": ["international"],
  "readOnly": true,
  "upstream": "https://udaybooking.com"
}
```

### Connecting a client

Claude Code, over HTTP:

```bash
claude mcp add --transport http udaybooking http://127.0.0.1:3004/mcp
```

Claude Desktop reaches an HTTP server through a stdio bridge:

```json
{
  "mcpServers": {
    "udaybooking": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3004/mcp"]
    }
  }
}
```

The MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Then choose **Streamable HTTP** and enter `http://127.0.0.1:3004/mcp`. The
Inspector runs in a browser, so allow its origin:

```bash
UDAYBOOKING_HTTP_ALLOWED_ORIGINS=http://localhost:6274 npm run start:http
```

### Sessions and shared state

Sessions are stateful — `initialize` returns an `Mcp-Session-Id` that subsequent
requests must send — but **the page cache and search index are shared across all
sessions**. This matters more than it sounds: a cold search index costs dozens of
requests to udaybooking.com, so per-session indexes would re-trigger the
throttling described in [Troubleshooting](#8-troubleshooting). Verified: a page
fetched in one session is served to a second session in ~4 ms instead of ~1.4 s.

Abandoned sessions are reaped after `UDAYBOOKING_HTTP_SESSION_IDLE_TTL_MS`
(default 30 minutes). This is necessary because closing a client transport does
**not** end its server session — only an explicit `DELETE /mcp` does, and a
crashed client never sends one.

### Security

The HTTP transport has **no authentication**, which is a deliberate choice for
what it serves: public, read-only pages, with no credentials held anywhere. Two
protections still apply, and you should understand both before changing them:

- **Loopback binding.** It binds `127.0.0.1`. Binding `0.0.0.0` is not a data
  risk, but it lets anyone on the network use your machine to fetch
  udaybooking.com — under your IP and your rate-limit budget. Widen it only
  behind a reverse proxy that terminates auth.
- **Origin validation.** A request carrying an `Origin` header not in
  `UDAYBOOKING_HTTP_ALLOWED_ORIGINS` is rejected with `403`. Without this, any
  web page you visited could POST to `localhost:3004` and drive the server
  through your browser. Requests with no `Origin` — every ordinary MCP client,
  and curl — pass through.

For public hosting (for example `mcp.udaybooking.com` behind Cloudflare and
Apache) four more guards apply:

- **Host allowlist.** Only `Host` names in `UDAYBOOKING_HTTP_ALLOWED_HOSTS`
  (default `localhost,127.0.0.1,[::1],mcp.udaybooking.com`) are answered; any
  other gets a generic `403`.
- **Rate limit.** `UDAYBOOKING_HTTP_RATE_LIMIT_PER_MIN` (default 60) per client
  IP on every path except `/health`, answered with `429` + `Retry-After`. Set
  `TRUST_PROXY=1` behind the proxy so the right-most `X-Forwarded-For` hop is the
  key; otherwise all clients share the proxy's bucket.
- **Session cap.** `UDAYBOOKING_HTTP_MAX_SESSIONS` (default 100); a further
  `initialize` gets `503` + `Retry-After: 30`.
- **Discovery URL.** `/.well-known/mcp.json` advertises `PUBLIC_BASE_URL`
  (production: `https://mcp.udaybooking.com`) and never reads `X-Forwarded-*`.

Upstream fetches are pinned to `udaybooking.com` and `www.udaybooking.com`
exactly; redirects are followed one hop at a time and each hop is checked
before it is requested; bodies above `UDAYBOOKING_MAX_RESPONSE_BYTES` (5 MB) are
refused.

Request bodies are capped at 1 MB, and unknown routes, bad JSON, stale session
ids and unsupported methods all return specific, actionable errors rather than a
bare 500.

Verify the whole surface against a running server:

```bash
npm run smoke:http
```

### Docker

A multi-stage `Dockerfile` builds a runtime image with no dev dependencies and
no build toolchain, running as a non-root user.

```bash
docker build -t udaybooking-mcp .
```

```bash
docker run --rm -p 127.0.0.1:3004:3004 udaybooking-mcp
```

The image runs the **HTTP transport** (`dist/http.js`), not stdio — a container
that speaks stdio has nothing to speak to. For Claude Desktop, run the server
from a checkout instead (section 4).

Two things to know before running it anywhere but your own machine:

- **It needs outbound network at runtime.** Every content tool reads
  udaybooking.com. With no egress the container starts and `/health` answers,
  but every content tool fails with `UPSTREAM_UNAVAILABLE`.
- **It binds `0.0.0.0` inside the container, and that is not the same decision
  as binding `0.0.0.0` on your host.** Binding loopback inside a container
  yields a process that looks healthy and answers nothing. Reachability is
  controlled by what you publish: `-p 127.0.0.1:3004:3004` keeps it on your
  machine, while `-p 3004:3004` exposes it to your network. The server still has
  no authentication, so publishing it publicly lets anyone who reaches it fetch
  udaybooking.com through your host and your rate-limit budget.

There is no secret to pass with `-e`: udaybooking publishes no authenticated
API, so the server holds no credentials. The image does set the politeness
values (`UDAYBOOKING_MAX_CONCURRENCY=2`,
`UDAYBOOKING_MIN_REQUEST_INTERVAL_MS=250`) so they are visible in
`docker inspect` rather than buried in `config.ts`.

A `HEALTHCHECK` polls `/health` every 30s. That endpoint needs no session and
makes no outbound request, so it reports that the process is alive — not that
udaybooking.com is reachable.

---

## 5. Use with Claude Code

From the project directory:

```bash
claude mcp add udaybooking -- node "$(pwd)/dist/index.js"
```

On Windows PowerShell:

```bash
claude mcp add udaybooking -- node "$PWD\dist\index.js"
```

Check it registered, then confirm inside a session with `/mcp`:

```bash
claude mcp list
```

To scope it to a single project, commit a `.mcp.json` at the repository root:

```json
{
  "mcpServers": {
    "udaybooking": {
      "command": "node",
      "args": ["./dist/index.js"]
    }
  }
}
```

Remove it with:

```bash
claude mcp remove udaybooking
```

---

## 6. Example requests

Read-only questions this server answers well:

- "What does udaybooking cost in India, and is there a platform fee?"
- "How does round robin decide which host takes a booking?"
- "Which reminder channels does udaybooking support, and when can a workflow fire?"
- "Summarise the availability docs — working hours, booking windows and date overrides."
- "What's the difference between round robin and collective scheduling?"
- "How does a guest reschedule or cancel, and what do they see about my calendar?"
- "Compare the Free and Professional plans and tell me when I'd need to upgrade."
- "Does udaybooking have a UK site, and are prices different there?"
- "Find everything in the docs about timezones."
- "What does udaybooking say about security and calendar tokens?"
- "List every documentation page."
- "Read the blog post about reminders and summarise the argument."

Requests it will **decline, with a reason** rather than pretend to satisfy:

- "Book me a 30-minute call tomorrow at 10am."
- "Cancel my appointment on Friday."
- "List my upcoming bookings."
- "Log in to my udaybooking account."
- "Upgrade me to the Professional plan."

For those, Claude should call `udaybooking_get_automation_capabilities` and
explain that udaybooking publishes no API this server can use, and that booking
must be done in the product itself.

---

## 7. Testing

```bash
npm test           # 143 unit/integration tests, fully mocked — no network
npm run test:watch
npm run typecheck
```

The suite covers the areas that matter:

| Area | Covered |
| --- | --- |
| Input validation | Min/max lengths, enum rejection, missing required args, applied defaults |
| Read-only requests | Catalogue paging, structured pricing, FAQ filtering, page rendering, truncation, search ranking |
| Authentication | Not applicable — asserted instead that no credential config exists and none is needed |
| Network failures | Retry-then-succeed, exhausted retries, timeouts, 429, 503, total sitemap failure |
| Empty results | Empty search, stopword-only query, non-matching FAQ filter, page with no offers |
| Invalid identifiers | 404 paths, unparseable sitemap entries, unknown tool names |
| Booking safeguards | No booking/availability/payment tool is registered; every unsupported capability has a reason and a route to unblocking it; `/api/` and off-host refusals |
| MCP registration | Tool list, annotations, descriptions, output schemas, resources, server instructions |
| HTTP sessions | Idle expiry, `touch` resetting the timer, `peek` not resetting it, selective reaping, close-failure tolerance, shutdown |

Tests never touch the network: fixtures in `tests/fixtures.ts` are abridged
recordings of real responses, and `tests/mock-fetch.ts` replaces `fetch`. **No
test creates a booking or a payment, because no code path can.**

### Live end-to-end checks

```bash
npm run smoke        # stdio transport, against the live site
```

Drives the built server over a real stdio MCP session using the official MCP
client, exercising all eight tools and both refusal paths. It makes roughly 45
requests (the search index warm dominates), so **run it sparingly** — see the
throttling note in [Troubleshooting](#8-troubleshooting).

```bash
npm run start:http   # in one terminal
npm run smoke:http   # in another
```

58 checks over real HTTP: health, /version, discovery, the browser landing page, tool registration, session issuance, a live
upstream call, cross-session cache reuse, `DELETE` session termination, and the
error paths for stale sessions, missing sessions, malformed JSON, unknown routes,
disallowed origins and unsupported methods.

---

## 8. Troubleshooting

**`fetch failed`, `UND_ERR_CONNECT_TIMEOUT`, or every tool suddenly failing**

You are being throttled. udaybooking.com sits behind Cloudflare and answers a
burst of requests by **refusing new connections for several minutes** rather than
returning `429`. This was reproduced during development: warming the search index
with ~50 rapid requests made the whole site unreachable from this client for
minutes afterwards.

Fix: wait a few minutes, then raise the politeness gap and lower concurrency.

```bash
UDAYBOOKING_MIN_REQUEST_INTERVAL_MS=500
UDAYBOOKING_MAX_CONCURRENCY=1
UDAYBOOKING_INDEX_MAX_PAGES=25
```

**First search takes several seconds**

Expected: it warms the index by fetching up to `UDAYBOOKING_INDEX_MAX_PAGES`
pages, spaced by the politeness gap (~10s at the defaults). Later searches in the
same market are served from cache. Lower `UDAYBOOKING_INDEX_MAX_PAGES` to trade
coverage for speed.

**"the catalogue is incomplete"**

One of the three sitemaps could not be read. The partial catalogue is *not*
cached, so simply call the tool again — the missing sitemap is re-fetched. This
warning exists so an incomplete catalogue is never reported as a genuinely empty
result.

**`NOT_FOUND` on a path you expected to work**

The market prefix comes **first**: `/in/docs/availability`, not
`/docs/in/availability`. Confirm with `udaybooking_list_pages`. Note that
unprefixed paths such as `/docs/availability` are served, but the site resolves
them to a market edition, so the returned `url` and `market` may show `in` or
another code.

**`DISALLOWED_PATH` for `/api/...`**

Intentional and not configurable. `robots.txt` disallows `/api/` for all user
agents, so the server refuses those paths in code.

**Tools do not appear in Claude Desktop**

Run `npm run build` first — the config points at `dist/index.js`. Use an absolute
path, escape backslashes on Windows (`\\`), and restart Claude Desktop fully.
Check its MCP log for the server's stderr output.

**Protocol errors or garbled responses (stdio)**

Nothing may write to stdout. All logging in this server goes to stderr by design;
if you extend it, never use `console.log`.

**`port already in use` (HTTP)**

Something already holds the port. Either stop it, or pick another:

```bash
UDAYBOOKING_HTTP_PORT=3005 npm run start:http
```

On Windows, find the holder with
`Get-NetTCPConnection -LocalPort 3004 -State Listen`; on macOS or Linux,
`lsof -i :3004`.

**`403 Forbidden` from the HTTP endpoint**

Your client sent an `Origin` header that is not allowed — normal for
browser-based clients such as the MCP Inspector. Add its origin:

```bash
UDAYBOOKING_HTTP_ALLOWED_ORIGINS=http://localhost:6274 npm run start:http
```

**`Unknown session … Re-initialize` (HTTP)**

The session expired or the server restarted. Re-run `initialize` to get a new
session id. Sessions are reaped after
`UDAYBOOKING_HTTP_SESSION_IDLE_TTL_MS` of inactivity.

---

## 9. Authentication and restrictions

### Authentication: none, by necessity

**This server holds no credentials of any kind** — no password, cookie, API key
or session token. `.env.example` contains no secret fields.

That is not an omission. udaybooking.com publishes no authenticated API, and the
product app its *Log in* links point to (`app.udaybooking.com`) does not serve
udaybooking at all — every route returns an identical SPA shell for an unrelated
product. There is nothing to authenticate against.

**If you need authenticated access,** log in through udaybooking's own product
interface in a browser. This server will not automate a login, store a session,
or act as a user, and it is not built to be extended that way without a
documented, permitted API.

### Restrictions observed and respected

- **`robots.txt`** — `Allow: /`, `Disallow: /api/` for every user agent. The
  server refuses `/api/` paths in code rather than trusting callers.
- **Terms of service** (last updated 29 September 2026) — prohibit disrupting,
  reverse-engineering and unauthorised access. Reading published pages within
  `robots.txt` is consistent with them; probing undocumented endpoints would not
  be, which is a second reason this server does not go looking for the "agent
  endpoints".
- **Rate limiting** — not advertised, but enforced in practice by connection
  refusal. Honoured with bounded concurrency, a minimum request interval,
  response caching and a capped index.
- **Host pinning** — only `udaybooking.com` is reachable, so a crafted `path`
  argument cannot turn the server into an open proxy.
- **No bot-detection circumvention.** The server identifies itself honestly in
  its `User-Agent`, with a contact URL.

### What it will not do

No payment, booking, cancellation or account change is possible, and none would
be performed even if an API existed: those are the account holder's to make.

---

## 10. Design decisions

**Why no Playwright.** The site is prerendered server-side (`x-nextjs-prerender:
1`), so plain `fetch` returns complete HTML for every page, including all JSON-LD.
A browser engine would add ~300 MB of dependency, a large startup cost and more
load on the origin, and buy nothing. The dependency is deliberately absent rather
than present-but-unused. Should udaybooking later publish client-rendered content
this server needs, that is the point to reconsider — not before.

**Why read JSON-LD instead of scraping.** The site publishes `Offer`, `FAQPage`,
`TechArticle` and `BreadcrumbList` data for search engines. Reading it gives exact
prices and exact authored answers, and it is far more stable than CSS-class
selectors on a Tailwind build.

**Why search is local.** There is no search endpoint, and the only plausible
location for one is robots-disallowed. The index is capped and section-prioritised
so documentation is never dropped in favour of marketing pages.

**Why a capability tool.** The most likely failure mode for an MCP server over a
booking site is a model confidently claiming a booking succeeded. A tool and a
resource that state plainly what is impossible — with evidence — is cheap
insurance, and `tests/server.test.ts` asserts that no booking-shaped tool is ever
registered.

**Why partial catalogues are not cached.** A memoised partial sitemap load turns a
transient network blip into permanently wrong answers ("no pages match" for pages
that exist). Completeness is tracked and surfaced instead.

---

## 11. Project layout

```
udaybooking-mcp-server/
├── src/
│   ├── index.ts                  # stdio entry point, signal and crash handling
│   ├── http.ts                   # Streamable HTTP entry point (port 3004 by default)
│   ├── server.ts                 # tool + resource registration, shared services
│   ├── config.ts                 # env configuration (Zod), no credentials
│   ├── constants.ts              # verified facts: origin, markets, robots rules
│   ├── capabilities.ts           # recorded capability report and its evidence
│   ├── tool-catalog.ts           # declared tool list for /version and discovery
│   ├── types.ts                  # domain types
│   ├── schemas/index.ts          # Zod input/output shapes for every tool
│   ├── services/
│   │   ├── http-client.ts        # host pinning, robots guard, retries, politeness gate
│   │   ├── site-client.ts        # sitemaps, page model, offers, FAQs
│   │   ├── search-index.ts       # lazy, capped, section-prioritised full-text index
│   │   ├── session-registry.ts   # HTTP session bookkeeping and idle expiry
│   │   └── http-policy.ts        # browser-vs-client detection, origin rules
│   ├── tools/
│   │   ├── search.ts
│   │   ├── pages.ts              # get_page, list_pages
│   │   ├── pricing.ts
│   │   ├── faqs.ts
│   │   ├── site.ts               # list_markets, get_site_summary, capabilities
│   │   └── helpers.ts            # result shaping, clamping, error guard
│   └── utils/
│       ├── html.ts               # landmark extraction, chrome stripping, JSON-LD
│       ├── errors.ts             # error taxonomy with actionable messages
│       ├── logger.ts             # stderr-only structured logging with redaction
│       └── cache.ts              # TTL + LRU cache
├── tests/                        # 143 tests, fully mocked
├── scripts/
│   ├── smoke.mjs                 # live end-to-end check over real stdio MCP
│   └── smoke-http.mjs            # 58 checks against a running HTTP server
├── Dockerfile                    # multi-stage image, runs dist/http.js as non-root
├── .dockerignore
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 12. What needs further documentation or access

These are blocked on information udaybooking does not publish. Each would be
straightforward to add given the specification named.

| Capability | What is needed |
| --- | --- |
| `create_booking` | The "agent endpoints" specification: base URL, auth scheme, request/response schemas, idempotency semantics, and written confirmation that automated booking is permitted. |
| `check_availability` | An availability endpoint, or a reachable public booking-page URL whose slots can be read. |
| `list_my_bookings`, `cancel_booking`, `reschedule_booking` | API documentation plus an authentication method (API key or OAuth) and a working account surface. |
| `get_service_details` | A real booking-type/host resource. Only the marketing preview exists today. |
| Webhook management | A documented webhook management API. |
| Anything under `/api/` | A `robots.txt` change or explicit written permission, *and* actual endpoint documentation. |

Two further unknowns worth flagging:

- **`app.udaybooking.com` appears misconfigured.** It serves an unrelated
  application (`HelloGrowthCRM`) on every route, including the `/login` and
  `/signup` targets linked from every page of the marketing site. If a real
  product app exists elsewhere, its hostname is not published on the site.
- **The annual price is prose-only.** The 20% annual discount (₹719 / $8) appears
  in page text and `llms.txt`, but only the monthly rate is in structured data, so
  `udaybooking_get_pricing` returns the monthly figure and says so.

If you can supply any of the above — API docs, a correct app hostname, or written
permission — say so and the corresponding tools can be implemented against it.

---

## License

MIT
