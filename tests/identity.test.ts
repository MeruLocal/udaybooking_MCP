import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "../src/server.js";
import { CAPABILITY_REPORT, renderCapabilityReport } from "../src/capabilities.js";
import { renderLanding } from "../src/landing.js";
import { loadConfig } from "../src/config.js";

/**
 * This is Udaybooking's own server. Agents repeat its self-description to
 * users, so none of it may call itself unofficial, describe the website as
 * broken, or name another product.
 */

// Extra brand names that must never appear come from the environment
// (FORBIDDEN_BRANDS, comma-separated) so they are not written into this repo.
const extraBrands = (process.env.FORBIDDEN_BRANDS ?? "")
  .split(",")
  .map((b) => b.trim())
  .filter(Boolean)
  .map((b) => new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

const FORBIDDEN = [/unofficial/i, /not affiliated/i, /\bmock\b/i, /unreachable/i, ...extraBrands];

async function instructions(): Promise<string> {
  const { server } = buildServer({ logLevel: "silent" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([client.connect(a), server.connect(b)]);
  const text = client.getInstructions() ?? "";
  await client.close();
  return text;
}

describe("official identity", () => {
  const landing = renderLanding({ name: SERVER_NAME, version: SERVER_VERSION, mcpPath: "/mcp" });

  it("no agent- or human-facing text disowns the product or names another one", async () => {
    const surfaces = {
      landing,
      report: renderCapabilityReport(),
      reportJson: JSON.stringify(CAPABILITY_REPORT),
      instructions: await instructions(),
    };
    for (const [where, text] of Object.entries(surfaces)) {
      for (const re of FORBIDDEN) {
        expect(re.test(text), `${where} matches ${re}`).toBe(false);
      }
    }
  });

  it("the instructions open by naming the official server", async () => {
    expect((await instructions()).startsWith("This is the official Udaybooking MCP server.")).toBe(true);
  });

  it("the landing page states the lead text once and carries the official footer", () => {
    expect(landing.split("The official MCP server for").length - 1).toBe(1);
    expect(landing).toContain("<title>Udaybooking MCP Server</title>");
    expect(landing).toContain(`${SERVER_NAME} v${SERVER_VERSION} · official MCP server for Udaybooking.`);
  });

  it("does not link the app subdomain", () => {
    for (const text of [landing, renderCapabilityReport()]) {
      expect(text).not.toMatch(/app\.udaybooking\.com/i);
    }
  });

  it("the default user agent names the real repository, not a placeholder", () => {
    const ua = loadConfig({}).userAgent;
    expect(ua).not.toContain("your-org");
    expect(ua).toBe(`udaybooking-mcp-server/${SERVER_VERSION} (+https://github.com/MeruLocal/udaybooking_MCP)`);
  });
});
