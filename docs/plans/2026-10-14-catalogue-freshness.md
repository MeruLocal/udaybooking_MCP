# Plan: let the page catalogue and search index expire

- **Severity:** P2 (stale answers; skill §3 freshness / C7)
- **Effort:** S

## Finding

Two caches never expire, so a long-running HTTP process keeps serving the site as it was when the process started.

- **Catalogue:** `SiteClient.getCatalogResult()` (`src/services/site-client.ts:64-80`) memoises `catalogPromise` for the life of the process once all three sitemaps load. It is reset only on a partial or failed load (`:72`, `:76`). New or removed pages never show up in `udaybooking_list_pages` until a restart.
- **Search index:** `SearchIndex.indexes` (`src/services/search-index.ts:69`, `:148-158`) holds one `MarketIndex` per market forever. The only `delete` is on a build failure (`:152`). `builtAt` is recorded (`:217`) but never read. The index stores its own copy of the page text (`haystack`, `original`), so the 15-minute page cache TTL (`config.cacheTtlMs`) does not refresh search results.
- Effect: after a site edit, `udaybooking_get_page` returns the new text (page cache expires) while `udaybooking_search_content` still ranks and quotes the old text, and new pages are unsearchable. Agents then cite snippets that no longer exist on the site.
- The Docker image is meant to run for weeks behind Apache, so "restart to refresh" is not a plan.

Measured: `audit-live-mcp.mjs` (2026-10-14, local scratch build, `/mcp`) has no freshness probe for this server (no `synced_at` in output), so this comes from reading the code. Not checked: how often udaybooking.com actually changes (the sandbox cannot reach it).

## Proposed fix

1. **Config:** `UDAYBOOKING_CATALOG_TTL_MS` (default 6 h) and `UDAYBOOKING_INDEX_TTL_MS` (default 6 h), in `src/config.ts` and `.env.example`. `0` keeps today's behaviour (never expire).
2. **`SiteClient`:** store `{ promise, loadedAt }`. In `getCatalogResult()`, when `now - loadedAt > catalogTtlMs`, start a new load but keep serving the old result until the new one succeeds (stale-while-revalidate). A failed refresh keeps the old catalogue and logs a warning.
3. **`SearchIndex.getIndex(market)`:** same pattern using `builtAt` and `indexTtlMs`. Rebuild in the background; serve the old index until the new one resolves. Only one rebuild per market at a time.
4. **Budget:** the rebuild goes through the same `HttpClient` slot and politeness gate, so a refresh costs at most `indexMaxPages` (40) fetches per market per TTL. Most of those pages are already in the page cache only if requested within 15 min, so expect the full 40.
5. **`/health`:** add `catalogLoadedAt` and per-market `indexBuiltAt` so an operator can see the age.
6. **Tool output:** add `indexed_at` (ISO) to `udaybooking_search_content` structured output, so an agent can tell how fresh a snippet is.

## Tests to add

- `site-client.test.ts`: with an injected clock, a second `getCatalog()` inside the TTL makes no fetch; after the TTL it fetches again; while that refresh is pending the old entries are returned; a failed refresh keeps the old entries.
- `search-index.test.ts`: same for `search()` with a changed fixture page: after the TTL the new text is searchable and the old snippet is gone.
- `config.test.ts`: defaults and `0`.

## Risks, rollout, decisions

- More origin traffic: up to 8 markets × 40 pages every 6 h if every market is searched. That is well under what the politeness gate allows, but it is new load on udaybooking.com. Keep the default TTL generous.
- Depends on nothing; can merge before or after the HTTP hardening plan (#5).
- **Founder:** is 6 hours the right freshness target, or is daily enough?
