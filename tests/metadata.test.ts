import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SERVER_VERSION } from "../src/server.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
  repository?: { url: string };
  homepage?: string;
  bugs?: { url: string };
};
const serverJson = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
  remotes: { type: string; url: string }[];
  packages?: unknown[];
};

describe("registry metadata", () => {
  it("reads the server version from package.json", () => {
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  it("server.json matches the package version and points at the /mcp remote", () => {
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.remotes[0]?.type).toBe("streamable-http");
    expect(serverJson.remotes[0]?.url).toMatch(/^https:\/\/.+\/mcp$/);
    // Not published to npm, so no packages entry yet.
    expect(serverJson.packages).toBeUndefined();
  });

  it("package.json carries ownership metadata", () => {
    expect(pkg.repository?.url).toContain("github.com/MeruLocal/udaybooking_MCP");
    expect(pkg.homepage).toBeTruthy();
    expect(pkg.bugs?.url).toBeTruthy();
  });
});
