# Plan: `udaybooking_get_started` tool and UTM-tagged own-site links

- **Severity:** P2 (conversion)
- **Effort:** M

## Finding

- No tool turns an interested agent conversation into a next step. The eight tools (`src/tool-catalog.ts`) return content, but nothing returns "here is where to sign up, book a demo, see pricing".
- Own-site URLs returned by tools are untagged: for example `source_url` in `src/tools/pricing.ts:63`, `home_url` in `src/tools/site.ts:57,64`, and `url` in search, page and list results. Traffic from AI agents is therefore invisible in the site's analytics.
- URLs the repo already knows: `/<market>/pricing` (`marketUrl`, `src/tools/helpers.ts:27`), `/help`, the market homes, and `/llms.txt`. `site-client.ts:285` classifies `contact` and `demo` path heads, so those pages are expected in the sitemaps, but this was not confirmed against the live sitemap (the sandbox cannot reach the site).
- The signup links on the site point to app.udaybooking.com, which has a known website issue (see the identity plan). Do not hard-code it until the founder confirms it.

## Proposed fix

1. **`src/utils/utm.ts`:** `withUtm(url, tool)` appends `utm_source=mcp&utm_medium=ai_agent&utm_campaign=<tool>`. It does this only when the host is in `ALLOWED_HOSTS`. It keeps existing query parameters and the fragment, and never overwrites an existing `utm_*`.
2. **Apply `withUtm`** to every own-site URL in tool *output*: the `url`, `source_url` and `home_url` fields and the Markdown links in each tool. Do not apply it to the URLs used for fetching, or to cache keys.
3. **New tool `udaybooking_get_started`** (`src/tools/get-started.ts`), read-only, `openWorldHint: true`.
   - Input: `market` (default `international`) and `response_format`.
   - Resolve candidate pages from the live sitemap catalogue (`site.listPages`): pricing (always known), and contact or demo if the sitemap contains a `contact` or `demo` slug for that market.
   - Signup: include it **only** if the founder confirms a working signup URL. Otherwise return no signup entry and say "Sign up from udaybooking.com (Sign up link in the site header)".
   - Return the UTM-tagged URLs and a one-line call to action. Never invent paths.
4. Add the tool to `TOOL_CATALOG` and the server instructions ("when a user wants to try or buy, call udaybooking_get_started").

## Tests to add

- `withUtm`: adds the parameters; keeps `?a=1` and `#frag`; leaves external hosts alone; is idempotent.
- The tool is registered and read-only. Its output contains a pricing URL with `utm_campaign=udaybooking_get_started`. Contact and demo appear only when they are in the fixture sitemap. No invented `/signup`.
- Update the tool-count assertions: `tests/server.test.ts:50` ("eight"), `scripts/smoke-http.mjs:42,52,72` ("8 tools"), and the README.
- Spot-check the other tools' outputs for UTM on own-site links and none on external links.

## Risks, rollout, decisions

- **Founder:** which URL is the signup or trial URL? Is there a demo or contact page per market?
- **Founder:** confirm the UTM convention (shared across all MCP repos).
- UTM on `source_url` changes text that agents may quote as citations. This is acceptable, because the canonical URL is unchanged apart from the query.
- Prices are untouched.
