# Plan: registry metadata, runtime version and protocol version

- **Severity:** P2
- **Effort:** S

## Finding

- No `server.json`, so the server cannot be listed in the MCP Registry. The planned remote is `https://mcp.udaybooking.com/mcp`.
- `src/server.ts:20`: `SERVER_VERSION = "1.0.0"` is hard-coded and duplicates `package.json` `version`. It will drift on the first bump.
- `src/http.ts:43`: `MCP_PROTOCOL_VERSION = "2025-06-18"` is hard-coded for `/version` and discovery, while the installed SDK's `LATEST_PROTOCOL_VERSION` is `2025-11-25` (measured in `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js`).
- `src/server.ts:108`: the log says `tools: 8` literally, and the comment at `:55` says "All eight tools".
- Icons: no icon URL on udaybooking.com is known to this repo, so icons are skipped (see decisions).
- Audit (re-audit): `audit-live-mcp.mjs` (new script, 2026-10-14, local scratch build of main at 5b98fb1, `/mcp`, `--forbid-brands HelloGrowthCRM,hellocrm --sample-tool udaybooking_get_automation_capabilities`) gave **6 fail · 7 warn · 31 pass**. The earlier baseline (old script) was 2 fail · 3 warn · 15 pass.
  - FAIL `C13.well_known` "manifest hand-lists tools" (`/.well-known/mcp.json` `tools`). Skill §4 D2 makes this a **P1** requirement, not cosmetic.
  - WARN `C16.cors`: no `Access-Control-Allow-Origin: *` on the manifest.
  - The old "/version tools mismatch" FAIL and the `mcp_endpoint` WARN no longer fire with the new script (it accepts `endpoint`), so the old numbers above no longer apply.
- (Re-audit) **Ownership metadata (skill §4 B4):** `package.json` has no `repository`, `homepage` or `bugs` field, and there is no `LICENSE` file although `license` is `MIT`.
- (Re-audit) npm: `https://registry.npmjs.org/udaybooking-mcp-server` returns 404 (not published), consistent with leaving out `packages`.

## Proposed fix

1. **`server.json`** (shape copied from the HelloGrowthCRM website MCP), with:
   - schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
   - name `io.github.merulocal/udaybooking`
   - description: the official read-only server
   - `version` = package.json version
   - repository `https://github.com/MeruLocal/udaybooking_MCP`
   - `websiteUrl` `https://udaybooking.com`
   - `remotes: [{type: "streamable-http", url: "https://mcp.udaybooking.com/mcp"}]`
   - No `packages` entry until an npm package is published (it is not published today).
2. **`src/version.ts`:** read `package.json` at runtime (`createRequire(import.meta.url)("../package.json").version`; `package.json` is already in the published `files`). `server.ts` exports `SERVER_VERSION` from it.
3. **`src/http.ts`:** `import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js"` in place of the constant.
4. **`src/server.ts`:** log `tools: TOOL_CATALOG.length` and drop "eight" from the comment.
5. **`scripts/check-versions.mjs`:** fail if `package.json`, `server.json` `version` and `server.json` `packages[*].version` differ. Run it in `npm test` or CI.
6. **Required** (re-audit correction: no longer optional), to clear the audit items: add `mcp_endpoint` to `/version`, add `Access-Control-Allow-Origin: *` on `/.well-known/mcp.json`, and replace the manifest's tool list with `toolCount` (`tools/list` stays the source of truth). This changes the `/version` and manifest shape that `scripts/smoke-http.mjs` checks, so update it in the same PR.

7. (Re-audit) **`package.json`:** add `repository` (`git+https://github.com/MeruLocal/udaybooking_MCP.git`), `homepage` and `bugs`. Add a `LICENSE` file only after the founder names the copyright holder; this plan does not choose one.

## Tests to add

- `SERVER_VERSION === pkg.version`.
- `server.json` parses, `version` equals the package version, and its remote URL ends with `/mcp`.
- `/version` `protocolVersion === LATEST_PROTOCOL_VERSION` (end to end on a spawned server, or by extracting a pure `versionPayload()`).
- Re-run the audit. Expect the `C13.well_known` FAIL and the `C16.cors` WARN to clear.

## Risks, rollout, decisions

- **Founder:** the registry name (`io.github.merulocal/udaybooking` vs a domain-verified `com.udaybooking/mcp`, which needs DNS or HTTP proof on udaybooking.com).
- **Founder:** an icon URL on udaybooking.com, if one exists. Skipped until known.
- **Founder:** the copyright holder for the `LICENSE` file (legal owner names are out of scope for this audit).
- Publishing to the registry is a separate manual step, done after mcp.udaybooking.com is live.
