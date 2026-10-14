import { z } from "zod";
import { SITE_ORIGIN } from "./constants.js";
import { PACKAGE_VERSION } from "./version.js";

/**
 * Runtime configuration, entirely from environment variables.
 *
 * There are deliberately no credential settings here. udaybooking.com publishes
 * no authenticated API (see README "Authentication"), so this server never holds
 * a password, cookie, API key or session token — there is nothing to leak.
 */
const ConfigSchema = z.object({
  /** Origin to fetch from. Override only to point at a staging mirror. */
  baseUrl: z.string().url().default(SITE_ORIGIN),

  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(15_000),

  /** Retry attempts after the first try, for transient failures only. */
  maxRetries: z.coerce.number().int().min(0).max(5).default(2),

  /**
   * Base delay for exponential backoff between retries, in milliseconds.
   * Deliberately generous: when this origin throttles, it drops connections
   * rather than returning 429, and a tight retry loop makes that worse.
   */
  retryBaseDelayMs: z.coerce.number().int().min(50).max(10_000).default(800),

  /**
   * Minimum gap between the start of one request and the next, in milliseconds.
   *
   * This exists because of observed behaviour, not theory: warming the search
   * index with ~50 rapid requests caused udaybooking.com's edge to start
   * dropping connections for several minutes afterwards. Spacing requests keeps
   * the server usable.
   */
  minRequestIntervalMs: z.coerce.number().int().min(0).max(5_000).default(250),

  /** How long a fetched page stays usable in the in-memory cache. */
  cacheTtlMs: z.coerce.number().int().min(0).max(86_400_000).default(900_000),

  /** Maximum cached pages before least-recently-used entries are evicted. */
  cacheMaxEntries: z.coerce.number().int().min(16).max(5_000).default(400),

  /**
   * Simultaneous in-flight requests to the origin. Kept low on purpose: this is
   * someone else's website, and the search index warms by fetching many pages.
   */
  maxConcurrency: z.coerce.number().int().min(1).max(8).default(2),

  /**
   * Maximum pages fetched when warming one market's search index. Bounds both
   * first-call latency and load on the origin.
   */
  indexMaxPages: z.coerce.number().int().min(5).max(200).default(40),

  /**
   * Identifies this client to the origin, with a contact URL, as a well-behaved
   * crawler should.
   */
  userAgent: z
    .string()
    .min(8)
    .default(`udaybooking-mcp-server/${PACKAGE_VERSION} (+https://github.com/MeruLocal/udaybooking_MCP)`),

  /**
   * Largest response body read from the origin, in bytes. A larger (or endless)
   * response is refused rather than buffered whole into memory.
   */
  maxResponseBytes: z.coerce.number().int().min(10_000).max(100_000_000).default(5_000_000),

  /** Threshold for stderr logging. stdout is reserved for MCP framing. */
  logLevel: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

  /* ---- HTTP transport: used only by src/http.ts, never by stdio ---- */

  /** TCP port for the Streamable HTTP transport. */
  httpPort: z.coerce.number().int().min(1).max(65_535).default(3004),

  /**
   * Interface to bind. Loopback by default on purpose: this server has no
   * authentication, so binding 0.0.0.0 would expose it to the whole network.
   * Change it only behind a reverse proxy that terminates auth.
   */
  httpHost: z.string().min(1).default("127.0.0.1"),

  /**
   * Browser origins allowed to call the HTTP endpoint, comma-separated.
   *
   * This is DNS-rebinding protection. Without it, any web page the user happens
   * to visit could POST to localhost:3004 and drive this server from their
   * browser. A request whose `Origin` header is not on this list is rejected;
   * a request with no `Origin` — which is every ordinary MCP client and curl —
   * is allowed through.
   */
  httpAllowedOrigins: z
    .string()
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  /**
   * Idle time after which an HTTP session is closed, in milliseconds.
   *
   * Needed because clients are not obliged to end their sessions: closing a
   * client transport does not send `DELETE /mcp`, and a crashed client never
   * will. Without expiry the server holds one McpServer per client that ever
   * connected.
   */
  httpSessionIdleTtlMs: z.coerce.number().int().min(10_000).max(86_400_000).default(1_800_000),

  /**
   * Requests per minute per client IP on the HTTP transport (every path except
   * `/health`). `0` disables the limit. Without it one client can spend the
   * whole politeness budget toward udaybooking.com and starve everyone else.
   */
  httpRateLimitPerMin: z.coerce.number().int().min(0).max(100_000).default(60),

  /** Most concurrent HTTP sessions. A further `initialize` gets 503. */
  httpMaxSessions: z.coerce.number().int().min(1).max(100_000).default(100),

  /**
   * `Host` header values (hostname only, ports ignored) the HTTP transport
   * answers. Anything else gets a generic 403: this is the DNS-rebinding guard
   * for clients that send no `Origin`.
   */
  httpAllowedHosts: z
    .string()
    .default("localhost,127.0.0.1,[::1],mcp.udaybooking.com")
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),

  /**
   * Trust `X-Forwarded-For` for the client IP (right-most hop only). Set to 1
   * only behind a proxy you control (Cloudflare/Apache); with no proxy in front
   * a client could otherwise pick its own rate-limit bucket.
   */
  trustProxy: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((v) => v === "1" || v === "true"),

  /**
   * The public base URL advertised by `/.well-known/mcp.json`, for example
   * `https://mcp.udaybooking.com`. Never derived from forwarded headers. Empty
   * is treated as unset.
   */
  publicBaseUrl: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim().replace(/\/+$/, "") : undefined))
    .pipe(z.string().url().optional()),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Reads configuration from `env`, falling back to documented defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    baseUrl: env.UDAYBOOKING_BASE_URL,
    requestTimeoutMs: env.UDAYBOOKING_REQUEST_TIMEOUT_MS,
    maxRetries: env.UDAYBOOKING_MAX_RETRIES,
    retryBaseDelayMs: env.UDAYBOOKING_RETRY_BASE_DELAY_MS,
    minRequestIntervalMs: env.UDAYBOOKING_MIN_REQUEST_INTERVAL_MS,
    cacheTtlMs: env.UDAYBOOKING_CACHE_TTL_MS,
    cacheMaxEntries: env.UDAYBOOKING_CACHE_MAX_ENTRIES,
    maxConcurrency: env.UDAYBOOKING_MAX_CONCURRENCY,
    indexMaxPages: env.UDAYBOOKING_INDEX_MAX_PAGES,
    userAgent: env.UDAYBOOKING_USER_AGENT,
    maxResponseBytes: env.UDAYBOOKING_MAX_RESPONSE_BYTES,
    logLevel: env.UDAYBOOKING_LOG_LEVEL,
    // PORT is honoured as a fallback so the usual hosting conventions work.
    httpPort: env.UDAYBOOKING_HTTP_PORT ?? env.PORT,
    httpHost: env.UDAYBOOKING_HTTP_HOST,
    httpAllowedOrigins: env.UDAYBOOKING_HTTP_ALLOWED_ORIGINS,
    httpSessionIdleTtlMs: env.UDAYBOOKING_HTTP_SESSION_IDLE_TTL_MS,
    httpRateLimitPerMin: env.UDAYBOOKING_HTTP_RATE_LIMIT_PER_MIN,
    httpMaxSessions: env.UDAYBOOKING_HTTP_MAX_SESSIONS,
    httpAllowedHosts: env.UDAYBOOKING_HTTP_ALLOWED_HOSTS,
    trustProxy: env.TRUST_PROXY,
    publicBaseUrl: env.PUBLIC_BASE_URL,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Invalid udaybooking-mcp-server configuration: ${detail}. ` +
        `Check the UDAYBOOKING_* environment variables against .env.example.`,
    );
  }

  return parsed.data;
}
