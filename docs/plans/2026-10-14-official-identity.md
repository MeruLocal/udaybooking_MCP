# Plan: present as the official Udaybooking MCP server

- **Severity:** P1 (agents repeat this text to users)
- **Effort:** S

## Finding

The server is Udaybooking's own, but its agent-facing and human-facing text says otherwise, or describes the website as broken.

- `src/http.ts:430`: landing footer reads "unofficial, not affiliated with udaybooking".
- `src/http.ts:405-423`: the lead paragraph is effectively written twice ("Read-only udaybooking website mirror ..." appears at 405 and 418). The second copy also says "its product app is unreachable" (420).
- `src/capabilities.ts:64-70`: the "Create a booking" reason tells agents the booking widget "is a static interactive mock" and that app.udaybooking.com "does not serve udaybooking".
- `src/capabilities.ts:91-98`, `131-135`: "Sign in" reason and evidence say app.udaybooking.com returns an SPA "titled 'HelloGrowthCRM'". This is a website issue tracked separately and should not be agent-facing.
- `README.md` (~700 lines) repeats the above (section 1 table, section 4a "unofficial and unaffiliated", section 9) and reads as an analysis report, not an operator README.
- `package.json:4`: description says "over stdio", but the server also ships Streamable HTTP (`src/http.ts`, `Dockerfile`).
- `src/config.ts:64` and `.env.example:54`: user agent uses the placeholder `https://github.com/your-org/udaybooking-mcp-server`.

Measured: `audit-live-mcp.mjs` against a local `dist/http.js` (127.0.0.1:3004/mcp) on main gave 2 fail · 3 warn · 15 pass. None of those checks covers this text; this finding comes from reading the code.

## Proposed fix

1. **Landing page:** move `sendLanding` HTML into `src/landing.ts` (`renderLanding(): string`) so it can be tested. Title: "Udaybooking MCP Server". One lead paragraph ("The official MCP server for udaybooking.com ... read-only ... no API key"), one limits paragraph ("does not create, change or cancel bookings, check live availability or take payments; people do that in Udaybooking itself"), one status line. Footer: `<name> v<version> · official MCP server for Udaybooking.`
2. **`src/capabilities.ts`:** keep the structure and every `notSupported` entry, but reword the reasons neutrally around *this server's* limits, for example "This server reads published website content only, so it cannot create a booking." Remove the evidence lines about app.udaybooking.com, HelloGrowthCRM and the preview widget. Keep the robots `/api/` rule and "no public API reference is published yet", because they are facts that explain the limits.
3. **`src/server.ts` instructions:** open with "This is the official Udaybooking MCP server." Keep READ-ONLY / CANNOT (an existing test asserts them).
4. **Discovery description** (`src/http.ts` `/.well-known/mcp.json`): "Official Udaybooking MCP server: read-only access to ...".
5. **`docs/internal-notes.md`** (new, not agent-facing): three dated lines on the app subdomain, the preview widget and the unpublished agent-endpoints reference.
6. **README:** rewrite to about 120 lines: what it is, a tools table, run (stdio and HTTP), configuration (the common env vars, pointing to `.env.example`), deploy (Docker), and the project layout.
7. **`package.json` description:** "Official Udaybooking MCP server: read-only access to udaybooking.com docs, guides, pricing and FAQs, over stdio or Streamable HTTP."
8. **User agent:** `udaybooking-mcp-server/<version> (+https://github.com/MeruLocal/udaybooking_MCP)` in `config.ts` and `.env.example`.
9. **`scripts/smoke-http.mjs:68,74`:** update the title and footer checks.

## Tests to add

- `tests/identity.test.ts`: `renderLanding()`, `renderCapabilityReport()`, `JSON.stringify(CAPABILITY_REPORT)` and the server instructions (read with a real client over `InMemoryTransport`) contain none of `/unofficial/i`, `/not affiliated/i`, `/\bmock\b/i`, `/hellogrowth/i`, `/unreachable/i`. The landing page contains the lead text exactly once. The default user agent does not contain `your-org`.
- The existing `tests/server.test.ts` capability and instructions tests must still pass unchanged.

## Risks, rollout, decisions

- Owner and licence names are unchanged.
- No prices are touched.
- **Founder:** confirm the user-agent contact URL should be the GitHub repo. A public page on udaybooking.com, such as a bot-info page, would be better if one exists.
- **Founder:** confirm the capitalisation "Udaybooking" for the product name. The site and code currently mix "udaybooking" and "UdayBooking".
- Not checked: live site content (the sandbox cannot reach udaybooking.com).
