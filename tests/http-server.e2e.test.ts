import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request } from "node:http";
import { fileURLToPath } from "node:url";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

/**
 * End-to-end checks of the HTTP transport's hardening, against a real spawned
 * server. Nothing here reaches udaybooking.com: only /health, discovery and
 * `initialize` are exercised, none of which fetch upstream.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

async function startServer(env: Record<string, string>): Promise<{ port: number; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/http.ts"], {
    cwd: root,
    env: {
      ...process.env,
      UDAYBOOKING_HTTP_PORT: String(port),
      UDAYBOOKING_HTTP_HOST: "127.0.0.1",
      UDAYBOOKING_LOG_LEVEL: "silent",
      ...env,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await raw(port, { path: "/health" });
      if (r.status === 200) return { port, child };
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("server did not start");
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw request, so the Host header can be set freely (fetch forbids it). */
function raw(
  port: number,
  opts: { path: string; method?: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: opts.path, method: opts.method ?? "GET", headers: opts.headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } },
});
const initHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("HTTP transport hardening (spawned server)", () => {
  let main: { port: number; child: ChildProcess };
  let capped: { port: number; child: ChildProcess };
  let limited: { port: number; child: ChildProcess };

  beforeAll(async () => {
    [main, capped, limited] = await Promise.all([
      startServer({ PUBLIC_BASE_URL: "https://mcp.udaybooking.com", UDAYBOOKING_HTTP_RATE_LIMIT_PER_MIN: "0" }),
      startServer({ UDAYBOOKING_HTTP_MAX_SESSIONS: "2", UDAYBOOKING_HTTP_RATE_LIMIT_PER_MIN: "0" }),
      startServer({ UDAYBOOKING_HTTP_RATE_LIMIT_PER_MIN: "3" }),
    ]);
  }, 30_000);

  afterAll(() => {
    for (const s of [main, capped, limited]) s?.child.kill();
  });

  it("refuses a foreign Host with a generic 403", async () => {
    const r = await raw(main.port, { path: "/version", headers: { host: "evil.example" } });
    expect(r.status).toBe(403);
    expect(r.body).not.toContain("evil.example");
  });

  it("answers an allowlisted Host", async () => {
    const r = await raw(main.port, { path: "/version", headers: { host: "mcp.udaybooking.com" } });
    expect(r.status).toBe(200);
  });

  it("advertises PUBLIC_BASE_URL in discovery, ignoring X-Forwarded-Host", async () => {
    const r = await raw(main.port, {
      path: "/.well-known/mcp.json",
      headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" },
    });
    const doc = JSON.parse(r.body) as { transport: { url: string } };
    expect(doc.transport.url).toBe("https://mcp.udaybooking.com/mcp");
  });

  it("without PUBLIC_BASE_URL, never advertises a forwarded host", async () => {
    const r = await raw(capped.port, {
      path: "/.well-known/mcp.json",
      headers: { "x-forwarded-host": "attacker.example" },
    });
    expect(r.body).not.toContain("attacker.example");
  });

  it("refuses the third initialize with 503 + Retry-After when the cap is 2", async () => {
    const statuses: number[] = [];
    let retryAfter: string | string[] | undefined;
    for (let i = 0; i < 3; i++) {
      const r = await raw(capped.port, { path: "/mcp", method: "POST", headers: initHeaders, body: INIT });
      statuses.push(r.status);
      if (r.status === 503) retryAfter = r.headers["retry-after"];
    }
    expect(statuses).toEqual([200, 200, 503]);
    expect(retryAfter).toBe("30");
  });

  it("rate-limits with 429 + Retry-After while /health stays 200", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await raw(limited.port, { path: "/version" })).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
    const r = await raw(limited.port, { path: "/version" });
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect((await raw(limited.port, { path: "/health" })).status).toBe(200);
  });

  it("reports the SDK's latest protocol version and the MCP endpoint on /version", async () => {
    const r = await raw(main.port, { path: "/version" });
    const v = JSON.parse(r.body) as { protocolVersion: string; mcp_endpoint: string };
    expect(v.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(v.mcp_endpoint).toBe("/mcp");
  });

  it("serves the manifest with CORS and a tool count instead of a tool list", async () => {
    const r = await raw(main.port, { path: "/.well-known/mcp.json" });
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    const doc = JSON.parse(r.body) as { toolCount: number; tools?: unknown };
    expect(doc.toolCount).toBeGreaterThan(0);
    expect(doc.tools).toBeUndefined();
  });

  it("does not let a client escape the limit with a spoofed X-Forwarded-For", async () => {
    const r = await raw(limited.port, { path: "/version", headers: { "x-forwarded-for": "198.51.100.7" } });
    expect(r.status).toBe(429);
  });
});
