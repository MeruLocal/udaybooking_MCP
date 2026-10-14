/**
 * Live end-to-end check of the Streamable HTTP transport.
 *
 * Drives a running `npm run start:http` server with the official MCP client over
 * real HTTP, then exercises the HTTP-specific concerns the stdio smoke test
 * cannot cover: session reuse, the shared cache across sessions, the health
 * endpoint, and the error paths for bad sessions, bad JSON and unknown routes.
 *
 * Usage:  node scripts/smoke-http.mjs [baseUrl]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.argv[2] ?? "http://127.0.0.1:3004").replace(/\/+$/, "");
const endpoint = `${base}/mcp`;

const text = (res) => res.content?.map((c) => c.text ?? "").join("\n") ?? "";
let failures = 0;

function check(label, condition, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log(`\n== HTTP transport check against ${endpoint} ==\n`);

// ---------------------------------------------------------------- health
console.log("health endpoint");
const health = await fetch(`${base}/health`).then((r) => r.json());
check("status ok", health.status === "ok");
check("reports streamable-http", health.transport === "streamable-http");
check("declares read-only", health.readOnly === true);
check("names upstream", typeof health.upstream === "string", health.upstream);

// --------------------------------------------------------------- /version
console.log("\nversion endpoint");
const version = await fetch(`${base}/version`).then((r) => r.json());
check("reports server name", version.name === "udaybooking-mcp-server");
check("reports a version", typeof version.version === "string", version.version);
check("reports protocol version", typeof version.protocolVersion === "string", version.protocolVersion);
check("lists 8 tools", version.tools?.length === 8, `got ${version.tools?.length}`);
check("states no API key is needed", version.requiresApiKey === false);
check("states no public upstream API", version.publicApiAvailable === false);

// ------------------------------------------------------------- discovery
console.log("\ndiscovery document");
const disco = await fetch(`${base}/.well-known/mcp.json`).then((r) => r.json());
check("advertises streamable-http", disco.transport?.type === "streamable-http");
check("advertises the /mcp url", String(disco.transport?.url).endsWith("/mcp"), disco.transport?.url);
check("declares no auth", disco.authentication?.type === "none");
check("lists the same 8 tools", disco.tools?.length === 8);
check("lists both resources", disco.resources?.length === 2);

// ---------------------------------------------------- browser landing page
console.log("\nbrowser landing page");
const landing = await fetch(`${base}/mcp`, {
  headers: {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
  },
});
const landingHtml = await landing.text();
check("navigation returns 200 HTML", landing.status === 200, `status ${landing.status}`);
check(
  "served as HTML",
  (landing.headers.get("content-type") ?? "").includes("text/html"),
);
check("titled in house style", landingHtml.includes("udaybooking Website MCP Server"));
check("links the mirrored site", landingHtml.includes("udaybooking.com</a>"));
check("states the tool count", landingHtml.includes("All 8 tools are public and read-only"));
check("states robots.txt is respected", landingHtml.includes("respects") && landingHtml.includes("robots.txt"));
check("carries the unaffiliated disclaimer", landingHtml.includes("unofficial, not affiliated with udaybooking"));
check("warns against sending credentials", landingHtml.includes("never send one here"));
check("links /version and /health", landingHtml.includes('href="/version"') && landingHtml.includes('href="/health"'));
check("links discovery", landingHtml.includes(String.fromCharCode(34) + "/.well-known/mcp.json" + String.fromCharCode(34)));

// The site root serves the same page, for any client, not just browsers.
const root = await fetch(base + "/");
const rootHtml = await root.text();
check("root serves the landing page", root.status === 200, "status " + root.status);
check(
  "root served as HTML",
  (root.headers.get("content-type") ?? "").includes("text/html"),
);
check("root matches the /mcp page", rootHtml === landingHtml);

const rootPost = await fetch(base + "/", { method: "POST" });
check("root rejects non-GET", rootPost.status === 405, "status " + rootPost.status);

// An MCP client's GET must NOT get the landing page.
const sseGet = await fetch(`${base}/mcp`, { headers: { accept: "application/json, text/event-stream" } });
check("protocol GET still gets a protocol error", sseGet.status === 400, `status ${sseGet.status}`);
check(
  "protocol GET is not HTML",
  !(sseGet.headers.get("content-type") ?? "").includes("text/html"),
);

// ------------------------------------------------------------- session 1
console.log("\nsession 1: tools and a cached read");
const t1 = new StreamableHTTPClientTransport(new URL(endpoint));
const c1 = new Client({ name: "http-smoke-1", version: "1.0.0" });
await c1.connect(t1);

check("session id issued", Boolean(t1.sessionId), t1.sessionId);

const { tools } = await c1.listTools();
check("8 tools listed", tools.length === 8, `got ${tools.length}`);
check(
  "all read-only",
  tools.every((t) => t.annotations?.readOnlyHint === true),
);
check(
  "no booking tool",
  !tools.some((t) => /create_booking|cancel_booking|check_availability/.test(t.name)),
);

const { resources } = await c1.listResources();
check("2 resources listed", resources.length === 2);

// A no-network tool: proves tool dispatch works over HTTP.
const caps = await c1.callTool({
  name: "udaybooking_get_automation_capabilities",
  arguments: { response_format: "json" },
});
check("capabilities tool returns", !caps.isError);
check("reports no public API", caps.structuredContent?.public_api_available === false);

// A live tool: proves the upstream path works through this transport.
const pricing = await c1.callTool({
  name: "udaybooking_get_pricing",
  arguments: { market: "in", currency: "INR" },
});
if (pricing.isError) {
  console.log(`  [WARN] live pricing call failed (upstream throttling?): ${text(pricing).slice(0, 160)}`);
} else {
  const pro = pricing.structuredContent?.offers?.find((o) => o.plan === "Professional");
  check("live pricing fetched", Boolean(pro), pro ? `${pro.price} ${pro.currency}` : "");
}

const afterFirst = await fetch(`${base}/health`).then((r) => r.json());
check("session counted", afterFirst.sessions >= 1, `sessions=${afterFirst.sessions}`);

// ------------------------------------------------------------- session 2
console.log("\nsession 2: separate session, shared cache");
const t2 = new StreamableHTTPClientTransport(new URL(endpoint));
const c2 = new Client({ name: "http-smoke-2", version: "1.0.0" });
await c2.connect(t2);

check("distinct session id", Boolean(t2.sessionId) && t2.sessionId !== t1.sessionId);

const cachedBefore = (await fetch(`${base}/health`).then((r) => r.json())).cachedPages;
const started = Date.now();
// market 'in' deliberately matches session 1's pricing call, so this reads the
// *same* URL (/in/pricing). Any other market is a different page and would miss.
const faqs = await c2.callTool({
  name: "udaybooking_get_faqs",
  arguments: { source: "pricing", market: "in" },
});
const elapsed = Date.now() - started;

if (faqs.isError) {
  console.log(`  [WARN] live FAQ call failed (upstream throttling?): ${text(faqs).slice(0, 160)}`);
} else {
  check("FAQ served in new session", faqs.structuredContent?.count > 0);
  // /in/pricing was fetched in session 1, so this must be a cache hit — which is
  // the whole point of sharing services across sessions.
  check("served from shared cache", elapsed < 250, `${elapsed}ms, cachedPages=${cachedBefore}`);
}

// ---------------------------------------------------------- error paths
console.log("\nerror paths");

const badSession = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-session-id": "00000000-0000-0000-0000-000000000000",
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});
check("unknown session rejected", badSession.status === 404, `status ${badSession.status}`);
check("names the stale session", (await badSession.text()).includes("Re-initialize"));

const noSession = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});
check("missing session rejected", noSession.status === 400, `status ${noSession.status}`);
check("tells client to initialize", (await noSession.text()).includes("initialize"));

const badJson = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: "{ not json",
});
check("malformed JSON rejected", badJson.status === 400, `status ${badJson.status}`);
check("reports a parse error", (await badJson.text()).includes("Parse error"));

const badRoute = await fetch(`${base}/nope`);
check("unknown route 404s", badRoute.status === 404, `status ${badRoute.status}`);
check("points at /mcp", (await badRoute.text()).includes("/mcp"));

const badOrigin = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
check("disallowed browser origin rejected", badOrigin.status === 403, `status ${badOrigin.status}`);

const badMethod = await fetch(endpoint, { method: "PUT" });
check("unsupported method 405s", badMethod.status === 405, `status ${badMethod.status}`);

// Refusals must still work over HTTP.
const robots = await c1.callTool({
  name: "udaybooking_get_page",
  arguments: { path: "/api/v1/bookings" },
});
check("robots-disallowed path refused", robots.isError === true);
check("explains robots.txt", text(robots).includes("robots.txt"));

// ------------------------------------------------------------- teardown
console.log("\nteardown");

// The spec-compliant way to end a session is DELETE /mcp, which the SDK exposes
// as terminateSession(). Note that close() alone does NOT do this — which is
// why the server also reaps idle sessions.
await t2.terminateSession();
const afterTerminate = await fetch(`${base}/health`).then((r) => r.json());
check("DELETE releases the session", afterTerminate.sessions === 1, `sessions=${afterTerminate.sessions}`);

await t1.terminateSession();
await c1.close();
await c2.close();

const afterClose = await fetch(`${base}/health`).then((r) => r.json());
check("all sessions released", afterClose.sessions === 0, `sessions=${afterClose.sessions}`);
check("idle reaper configured", afterClose.sessionIdleTtlMs > 0, `${afterClose.sessionIdleTtlMs}ms`);

console.log(failures === 0 ? "\nHTTP SMOKE OK\n" : `\nHTTP SMOKE FAILED: ${failures} check(s)\n`);
process.exit(failures === 0 ? 0 : 1);
