/**
 * End-to-end smoke test: drives the built server over a real stdio MCP session
 * using the official client, against the live site.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: { ...process.env, UDAYBOOKING_LOG_LEVEL: "warn" },
  stderr: "inherit",
});

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`TOOLS (${tools.length}):`);
for (const t of tools) {
  console.log(`  - ${t.name}  [readOnly=${t.annotations?.readOnlyHint}] outputSchema=${Boolean(t.outputSchema)}`);
}

const { resources } = await client.listResources();
console.log(`RESOURCES (${resources.length}): ${resources.map((r) => r.uri).join(", ")}`);

async function call(name, args, label) {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const ms = Date.now() - started;
  const text = res.content?.[0]?.text ?? "";
  console.log(`\n=== ${label ?? name} (${ms}ms) isError=${Boolean(res.isError)} ===`);
  console.log(text.slice(0, 700));
  if (res.structuredContent) {
    console.log(`-- structured keys: ${Object.keys(res.structuredContent).join(", ")}`);
  }
  return res;
}

// 1. Capabilities (no network).
await call("udaybooking_get_automation_capabilities", { response_format: "json" });

// 2. Markets (no network).
await call("udaybooking_list_markets", {});

// 3. Live: sitemap catalogue.
await call("udaybooking_list_pages", { section: "docs", market: "international", limit: 8 });

// 4. Live: structured pricing.
await call("udaybooking_get_pricing", { market: "in", currency: "INR", response_format: "json" });

// 5. Live: FAQ with filter.
await call("udaybooking_get_faqs", { source: "help", query: "reschedule" });

// 6. Live: one page.
await call("udaybooking_get_page", { path: "/docs/availability", max_chars: 800 });

// 7. Error path: robots-disallowed.
await call("udaybooking_get_page", { path: "/api/v1/bookings" }, "get_page /api/ (expect refusal)");

// 8. Error path: off-host.
await call("udaybooking_get_page", { path: "https://example.com/" }, "get_page off-host (expect refusal)");

// 9. Live: search (warms the index — slowest call).
await call("udaybooking_search_content", {
  query: "round robin host assignment",
  market: "international",
  sections: ["docs", "guides"],
  limit: 3,
});

// 10. Resource read.
const cap = await client.readResource({ uri: "udaybooking://capabilities" });
console.log(`\n=== resource udaybooking://capabilities ===`);
console.log((cap.contents?.[0]?.text ?? "").slice(0, 300));

await client.close();
console.log("\nSMOKE OK");
