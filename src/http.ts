#!/usr/bin/env node
/**
 * Entry point: udaybooking-mcp-server over Streamable HTTP.
 *
 * This is the remote/local-port deployment option, as an alternative to the
 * stdio entry point in `index.ts`. It uses Node's built-in `http` module rather
 * than Express, because the SDK's transport accepts Node request/response
 * objects directly and the server needs nothing else from a web framework.
 *
 * Shape of the deployment:
 *
 * - `POST /mcp`    — JSON-RPC requests (initialize, tools/list, tools/call, …)
 * - `GET  /mcp`    — SSE stream for server-initiated notifications
 * - `DELETE /mcp`  — terminate a session
 * - `GET  /health` — liveness and readiness, for a proxy or container probe
 *
 * Sessions are stateful (each client gets a session id), but the **page cache
 * and search index are shared across all sessions**. That matters: a cold index
 * costs dozens of requests to udaybooking.com, and per-session indexes would
 * re-trigger the throttling this server is built to avoid.
 *
 * Security posture: there is no authentication, because the server exposes only
 * public, read-only content and holds no credentials. It binds loopback by
 * default, answers only allowlisted `Host` names (DNS-rebinding guard), rate
 * limits each client IP, caps concurrent sessions, and validates `Origin` to
 * prevent a web page from driving it through the user's browser. The discovery
 * document's URL comes from `PUBLIC_BASE_URL`, never from forwarded headers.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer, createServices, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { SessionRegistry } from "./services/session-registry.js";
import {
  clientIp,
  decideOrigin,
  isAllowedHost,
  isBrowserNavigation,
  isLoopbackBind,
} from "./services/http-policy.js";
import { RateLimiter } from "./services/rate-limit.js";
import { TOOL_CATALOG } from "./tool-catalog.js";
import { CAPABILITY_REPORT } from "./capabilities.js";
import { SITE_ORIGIN } from "./constants.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./utils/logger.js";

const MCP_PATH = "/mcp";
/** MCP revision this server implements, reported by /version and discovery. */
const MCP_PROTOCOL_VERSION = "2025-06-18";
/** Request bodies are tiny JSON-RPC frames; anything larger is refused. */
const MAX_BODY_BYTES = 1_000_000;

/** A live client session: one transport bound to one McpServer. */
class Session {
  constructor(
    readonly transport: StreamableHTTPServerTransport,
    readonly server: McpServer,
  ) {}

  async close(): Promise<void> {
    await this.transport.close();
    await this.server.close();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  // One set of services for the whole process, shared by every session.
  const services = createServices(config, logger);
  const sessions = new SessionRegistry<Session>({ idleTtlMs: config.httpSessionIdleTtlMs });
  const limiter = new RateLimiter({ limit: config.httpRateLimitPerMin });

  // Reap abandoned sessions. Clients are not obliged to send DELETE, and a
  // crashed one cannot, so without this the process holds an McpServer per
  // client that ever connected. The timer is unref'd so it never keeps the
  // process alive on its own.
  const sweepMs = Math.max(30_000, Math.floor(config.httpSessionIdleTtlMs / 4));
  const sweeper = setInterval(() => {
    void sessions.reapIdle().then((reaped) => {
      if (reaped.length > 0) {
        logger.info("reaped idle sessions", { count: reaped.length, remaining: sessions.size });
      }
    });
  }, sweepMs);
  sweeper.unref();

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      logger.error("unhandled request error", {
        method: req.method,
        url: req.url,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 1. Host allowlist: the DNS-rebinding guard for clients that send no Origin.
    //    The reply is deliberately generic and does not echo the Host.
    //    /health is exempt so a proxy or container probe with its own Host works.
    const isHealth = (req.url ?? "/").split("?")[0] === "/health";
    if (!isHealth && !isAllowedHost(header(req, "host"), config.httpAllowedHosts)) {
      logger.warn("rejected request on disallowed host");
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    // 2. Per-client rate limit, on every path except the liveness probe.
    if (url.pathname !== "/health") {
      const ip = clientIp(req.socket.remoteAddress, header(req, "x-forwarded-for"), config.trustProxy);
      const decision = limiter.check(ip);
      if (!decision.allowed) {
        const body = JSON.stringify({
          error: "Too many requests",
          message: `Rate limit is ${config.httpRateLimitPerMin} requests per minute. Retry after ${decision.retryAfterSec}s.`,
        });
        res.writeHead(429, {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "retry-after": String(decision.retryAfterSec),
        });
        res.end(body);
        return;
      }
    }

    // 3. Origin check.
    const origin = decideOrigin(header(req, "origin"), config.httpAllowedOrigins);
    if (!origin.allowed) {
      logger.warn("rejected request on disallowed origin", { origin: req.headers.origin });
      sendJson(res, 403, {
        error: "Forbidden",
        message:
          `Origin '${String(req.headers.origin)}' is not allowed. Loopback origins ` +
          `(localhost / 127.0.0.1) are permitted by default; add others to ` +
          `UDAYBOOKING_HTTP_ALLOWED_ORIGINS. This check stops a web page you are visiting ` +
          `from driving this server through your browser.`,
      });
      return;
    }

    // The site root serves the same landing page as a browser visit to /mcp.
    // There is no MCP semantics on "/", so no content negotiation is needed:
    // anything that asks for it gets the page.
    if (url.pathname === "/" || url.pathname === "") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      sendLanding(res);
      return;
    }

    if (url.pathname === "/version") {
      sendJson(res, 200, {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        protocolVersion: MCP_PROTOCOL_VERSION,
        transport: "streamable-http",
        endpoint: MCP_PATH,
        readOnly: true,
        requiresApiKey: false,
        upstream: config.baseUrl,
        upstreamVerifiedAt: CAPABILITY_REPORT.verifiedAt,
        publicApiAvailable: CAPABILITY_REPORT.publicApiAvailable,
        toolCount: TOOL_CATALOG.length,
        tools: TOOL_CATALOG.map((t) => ({ name: t.name, summary: t.summary })),
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
      });
      return;
    }

    if (url.pathname === "/.well-known/mcp.json") {
      sendJson(res, 200, {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        description:
          "Read-only mirror of udaybooking.com public content: documentation, guides, help " +
          "centre, pricing and FAQs. Performs no booking, account or payment actions.",
        protocolVersion: MCP_PROTOCOL_VERSION,
        transport: {
          type: "streamable-http",
          url: `${publicBase(req, config.publicBaseUrl, config.httpHost, config.httpPort)}${MCP_PATH}`,
        },
        authentication: { type: "none", note: "No API key is required; never send credentials." },
        capabilities: { tools: {}, resources: {} },
        tools: TOOL_CATALOG.map((t) => ({ name: t.name, description: t.summary })),
        resources: ["udaybooking://capabilities", "udaybooking://llms.txt"],
        readOnly: true,
      });
      return;
    }

    if (url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        server: SERVER_NAME,
        version: SERVER_VERSION,
        transport: "streamable-http",
        endpoint: MCP_PATH,
        sessions: sessions.size,
        sessionIdleTtlMs: config.httpSessionIdleTtlMs,
        cachedPages: services.site.stats().cachedPages,
        indexedMarkets: services.search.indexedMarkets,
        readOnly: true,
        upstream: config.baseUrl,
      });
      return;
    }

    if (url.pathname !== MCP_PATH) {
      sendJson(res, 404, {
        error: "Not found",
        message:
          `No route for ${req.method} ${url.pathname}. The MCP endpoint is ${MCP_PATH}; ` +
          `/ is the landing page, and /version, /health and /.well-known/mcp.json report status.`,
      });
      return;
    }

    const sessionId = header(req, "mcp-session-id");

    // Someone opened this URL in a browser. `/mcp` is a JSON-RPC endpoint, so a
    // navigation can never carry a session id; answering with the protocol's
    // "Missing Mcp-Session-Id header" is correct but tells a human nothing.
    if (req.method === "GET" && sessionId === undefined && isBrowserNavigation(headerBag(req))) {
      sendLanding(res);
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req, res);
      if (body === undefined) return; // readBody already answered

      const existing = sessionId ? sessions.touch(sessionId) : undefined;
      if (existing) {
        await existing.transport.handleRequest(req, res, body);
        return;
      }

      if (sessionId) {
        // A stale session id, typically after a server restart. Say so clearly
        // rather than returning an opaque 404.
        sendJson(res, 404, {
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: `Unknown session '${sessionId}'. Re-initialize to obtain a new session id.`,
          },
          id: null,
        });
        return;
      }

      if (!isInitialize(body)) {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Missing Mcp-Session-Id header. Send an 'initialize' request first; its " +
              "response carries the session id to use for subsequent requests.",
          },
          id: null,
        });
        return;
      }

      await openSession(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const session = sessionId ? sessions.touch(sessionId) : undefined;
      if (!session) {
        sendJson(res, sessionId ? 404 : 400, {
          error: "Bad request",
          message: sessionId
            ? `Unknown session '${sessionId}'. It expired or the server restarted — ` +
              `send an 'initialize' request to start a new one.`
            : `Missing Mcp-Session-Id header. ${MCP_PATH} speaks MCP over JSON-RPC, not ` +
              `plain HTTP: POST an 'initialize' request first, then send the session id it ` +
              `returns on every later request. GET ${MCP_PATH} opens the notification ` +
              `stream for an existing session. Try /health for status.`,
        });
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405, { allow: "GET, POST, DELETE" }).end();
  }

  /** Creates a session: a fresh McpServer over shared services. */
  async function openSession(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    if (sessions.size >= config.httpMaxSessions) {
      logger.warn("session cap reached", { sessions: sessions.size, max: config.httpMaxSessions });
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Server is at its session limit. Retry shortly." },
        id: null,
      });
      res.writeHead(503, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        "retry-after": "30",
      });
      res.end(payload);
      return;
    }

    // Each session gets its own McpServer (the SDK binds one transport per
    // server) but reuses the process-wide cache and search index. Built before
    // the transport so the session callbacks below close over a live value.
    const { server } = buildServer(undefined, services);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.add(id, new Session(transport, server));
        logger.info("session opened", { sessionId: id, sessions: sessions.size });
      },
      onsessionclosed: (id) => {
        // Reached when the client sends DELETE /mcp. `forget` rather than
        // `close`, because the transport is already tearing itself down.
        sessions.forget(id);
        logger.info("session closed", { sessionId: id, sessions: sessions.size });
      },
    });

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) sessions.forget(id);
      void server.close();
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("shutting down", { signal, sessions: sessions.size });
    clearInterval(sweeper);
    httpServer.close();
    await sessions.closeAll();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.error("port already in use", {
        port: config.httpPort,
        hint: "Set UDAYBOOKING_HTTP_PORT to a free port, or stop the process holding this one.",
      });
    } else {
      logger.error("http server error", { error: error.message, code: error.code });
    }
    process.exit(1);
  });

  if (!isLoopbackBind(config.httpHost) && !config.publicBaseUrl) {
    logger.warn("PUBLIC_BASE_URL is not set on a non-loopback bind", {
      hint:
        "The discovery document will advertise http://<Host>. Behind Cloudflare/Apache set " +
        "PUBLIC_BASE_URL=https://mcp.udaybooking.com (and TRUST_PROXY set to your proxy hop count).",
    });
  }

  httpServer.listen(config.httpPort, config.httpHost, () => {
    logger.info("listening", {
      url: `http://${config.httpHost}:${config.httpPort}${MCP_PATH}`,
      health: `http://${config.httpHost}:${config.httpPort}/health`,
      transport: "streamable-http",
      originChecking:
        config.httpAllowedOrigins.length > 0
          ? config.httpAllowedOrigins.join(", ")
          : "browser origins rejected (none allowed); non-browser clients permitted",
    });
  });
}

/* --------------------------------------------------------------- helpers */

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The externally reachable base URL, for the discovery document.
 *
 * `PUBLIC_BASE_URL` when set. Otherwise the request's `Host`, which `handle()`
 * has already checked against the allowlist, and finally the bind address.
 * `X-Forwarded-*` is never read: any client can send it, and a caching proxy
 * would then serve the attacker's URL to everyone.
 */
function publicBase(
  req: IncomingMessage,
  configured: string | undefined,
  host: string,
  port: number,
): string {
  if (configured) return configured;
  const hostHeader = header(req, "host")?.trim().toLowerCase();
  return hostHeader ? `http://${hostHeader}` : `http://${host}:${port}`;
}

/** The headers the policy functions in `http-policy.ts` need. */
function headerBag(req: IncomingMessage) {
  return {
    accept: header(req, "accept"),
    origin: header(req, "origin"),
    secFetchMode: header(req, "sec-fetch-mode"),
    secFetchDest: header(req, "sec-fetch-dest"),
  };
}

/**
 * The page a person sees when they open the endpoint in a browser.
 *
 * Deliberately a plain document — one column, prose, inline monospace for paths,
 * default link colours — matching the house style used for other MCP server
 * landing pages in this estate (mcp.hellogrowthcrm.com). No cards, tables or
 * badges: the page exists to tell a human what this URL is and what it will not
 * do, not to look like an app.
 */
function sendLanding(res: ServerResponse): void {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>udaybooking Website MCP Server</title>
<meta name="robots" content="noindex">
<style>
  body {
    max-width: 47rem; margin: 0 auto; padding: 4.5rem 1.5rem 6rem;
    font: 17px/1.62 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
  }
  h1 { font-size: 2.45rem; line-height: 1.2; font-weight: 700; margin: 0 0 1.75rem; letter-spacing: -0.01em; }
  p { margin: 0 0 1.3rem; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86em;
    background: #f3f4f6; border-radius: 4px; padding: 0.1em 0.35em;
  }
  p.fine, p.foot { color: #6b7280; font-size: 0.8rem; line-height: 1.55; }
  p.foot { margin-top: 1.8rem; }
</style></head>
<body>
  <h1>udaybooking Website MCP Server</h1>

  <p>Read-only udaybooking website mirror (product knowledge: pricing, features, documentation,
  guides, FAQs, company &amp; contact info) from
  <a href="${SITE_ORIGIN}" rel="noopener noreferrer nofollow">udaybooking.com</a>. Connect via
  the Streamable HTTP endpoint at <code>${MCP_PATH}</code>. No API key is required — this server
  holds no customer data and performs no account, booking, or payment actions.</p>

  <p>Status: <a href="/version">/version</a> · Discovery:
  <a href="/.well-known/mcp.json">/.well-known/mcp.json</a> · Tools:
  <code>POST ${MCP_PATH}</code> → <code>tools/list</code></p>

  <p class="fine">This is not a customer booking or account API. It holds no customer data,
  performs no transactions, and needs no API key — never send one here.</p>

  <p>Read-only udaybooking website mirror (product knowledge: pricing, features, documentation,
  guides, FAQs). No API key is required, and the public endpoint returns no personal data.
  udaybooking publishes no documented public API and its product app is unreachable, so there is
  no booking, availability, rescheduling, cancellation, or payment capability — those actions are
  not implemented.</p>

  <p>All ${TOOL_CATALOG.length} tools are public and read-only. There are no content-management,
  write, or transactional tools, and none require an authenticated session. The server respects
  <code>robots.txt</code> and never requests <code>/api/</code> or submits forms.</p>

  <p>Status: <a href="/version">/version</a> · Health: <a href="/health">/health</a></p>

  <p class="foot">${SERVER_NAME} v${SERVER_VERSION} · unofficial, not affiliated with udaybooking.</p>
</body></html>`;

  const body = Buffer.from(html, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}


/** True when the body is (or contains) an `initialize` request. */
function isInitialize(body: unknown): boolean {
  const one = (m: unknown): boolean =>
    Boolean(m) && typeof m === "object" && (m as { method?: string }).method === "initialize";
  return Array.isArray(body) ? body.some(one) : one(body);
}

/**
 * Reads and parses a JSON body, enforcing a size cap. Answers the request
 * itself and returns `undefined` when the body is unusable.
 */
async function readBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        sendJson(res, 413, {
          error: "Payload too large",
          message: `Request body exceeded ${MAX_BODY_BYTES} bytes.`,
        });
        req.destroy();
        return undefined;
      }
      chunks.push(buf);
    }
  } catch {
    sendJson(res, 400, { error: "Bad request", message: "Could not read the request body." });
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    sendJson(res, 400, {
      jsonrpc: "2.0",
      error: { code: -32700, message: "Empty request body; expected a JSON-RPC message." },
      id: null,
    });
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    sendJson(res, 400, {
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error: request body is not valid JSON." },
      id: null,
    });
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      logger: SERVER_NAME,
      msg: "fatal startup error",
      ctx: { error: error instanceof Error ? error.message : String(error) },
    })}\n`,
  );
  process.exit(1);
});
