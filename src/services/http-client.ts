import type { Config } from "../config.js";
import type { Logger } from "../utils/logger.js";
import { ALLOWED_HOST, ROBOTS_DISALLOWED_PREFIXES } from "../constants.js";
import { UdayBookingError, disallowedPath, notFound } from "../utils/errors.js";

export interface FetchTextResult {
  url: string;
  status: number;
  body: string;
  fromCache: false;
}

/** Status codes worth another attempt: transient server and throttling errors. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

/**
 * HTTP client for the public site.
 *
 * Three things it guarantees, each of which exists for a reason observed during
 * analysis:
 *
 * 1. **Host pinning.** Only `udaybooking.com` is reachable. Tool arguments feed
 *    into URLs, so without this a caller could point the server at an arbitrary
 *    host and use it as a proxy.
 * 2. **robots.txt compliance.** `/api/` is `Disallow`ed for every user agent on
 *    this site, so the client refuses those paths outright instead of trusting
 *    callers to avoid them.
 * 3. **Bounded concurrency and retries.** The origin intermittently drops
 *    connections (reproduced repeatedly during analysis: curl exit with no
 *    status, then an immediate 200 on retry), so transient failures are retried
 *    with exponential backoff and jitter, and no more than `maxConcurrency`
 *    requests are ever in flight.
 */
export class HttpClient {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  /** Timestamp the next request is allowed to start, for the politeness gate. */
  private nextSlotAt = 0;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  /**
   * Resolves a site-relative path (or absolute same-origin URL) and rejects
   * anything off-host or robots-disallowed before a request is made.
   */
  resolveUrl(pathOrUrl: string): string {
    let url: URL;
    try {
      url = new URL(pathOrUrl, this.config.baseUrl);
    } catch {
      throw disallowedPath(
        `'${pathOrUrl}' is not a valid path or URL.`,
        "Pass a site-relative path such as '/in/pricing', or a full https://udaybooking.com/... URL.",
      );
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw disallowedPath(
        `Unsupported protocol '${url.protocol}'.`,
        "Only http(s) URLs on udaybooking.com can be fetched.",
      );
    }

    const host = url.hostname.toLowerCase();
    const onAllowedHost = host === ALLOWED_HOST || host.endsWith(`.${ALLOWED_HOST}`);
    if (!onAllowedHost) {
      throw disallowedPath(
        `Refusing to fetch '${host}'. This server only reads ${ALLOWED_HOST}.`,
        "This restriction is deliberate: it keeps the server from being used to fetch arbitrary hosts.",
      );
    }

    const blocked = ROBOTS_DISALLOWED_PREFIXES.find((prefix) => url.pathname.startsWith(prefix));
    if (blocked) {
      throw disallowedPath(
        `'${url.pathname}' is inside '${blocked}', which udaybooking.com's robots.txt disallows for all user agents.`,
        "udaybooking.com publishes no documented public API. Use the content tools " +
          "(udaybooking_search_content, udaybooking_get_page) for published pages instead.",
      );
    }

    return url.toString();
  }

  /** Fetches a URL as text, with host/robots checks, retries and a timeout. */
  async fetchText(pathOrUrl: string): Promise<FetchTextResult> {
    const url = this.resolveUrl(pathOrUrl);
    return this.withSlot(() => this.attempt(url));
  }

  private async attempt(url: string): Promise<FetchTextResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff =
          this.config.retryBaseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 120);
        this.logger.debug("retrying request", { url, attempt, backoff });
        await sleep(backoff);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: controller.signal,
          headers: {
            accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en",
            "user-agent": this.config.userAgent,
          },
        });

        // A redirect may legitimately leave the allowed host; re-check it.
        this.resolveUrl(res.url || url);

        if (res.status === 404 || res.status === 410) {
          throw notFound(
            `udaybooking.com returned ${res.status} for ${url}.`,
            "Confirm the path with udaybooking_list_pages — the site is market-prefixed " +
              "(for example '/in/docs/availability', not '/docs/in/availability').",
          );
        }

        if (res.status === 429) {
          throw new UdayBookingError("RATE_LIMITED", `udaybooking.com rate-limited this request (429).`, {
            status: 429,
            retryable: true,
            hint: "Lower UDAYBOOKING_MAX_CONCURRENCY or wait before retrying.",
          });
        }

        if (!res.ok) {
          throw new UdayBookingError(
            "UPSTREAM_UNAVAILABLE",
            `udaybooking.com returned HTTP ${res.status} for ${url}.`,
            { status: res.status, retryable: RETRYABLE_STATUS.has(res.status) },
          );
        }

        const body = await res.text();
        this.logger.debug("fetched", { url, status: res.status, bytes: body.length });
        return { url: res.url || url, status: res.status, body, fromCache: false };
      } catch (error) {
        lastError = error;

        if (error instanceof UdayBookingError) {
          if (!error.retryable || attempt === this.config.maxRetries) throw error;
          continue;
        }

        const isAbort = error instanceof Error && error.name === "AbortError";
        if (isAbort && attempt === this.config.maxRetries) {
          throw new UdayBookingError(
            "TIMEOUT",
            `Request to ${url} timed out after ${this.config.requestTimeoutMs}ms.`,
            {
              retryable: true,
              hint: "Raise UDAYBOOKING_REQUEST_TIMEOUT_MS if the network is slow.",
              cause: error,
            },
          );
        }
        if (attempt === this.config.maxRetries) {
          throw new UdayBookingError(
            "UPSTREAM_UNAVAILABLE",
            `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}.`,
            {
              retryable: true,
              hint: "udaybooking.com intermittently drops connections; this usually succeeds on retry.",
              cause: error,
            },
          );
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new UdayBookingError("UPSTREAM_UNAVAILABLE", `Could not reach ${url}.`, { retryable: true });
  }

  /**
   * Semaphore plus politeness gate: at most `maxConcurrency` requests are in
   * flight, and consecutive requests start at least `minRequestIntervalMs`
   * apart. The gate matters because this origin answers a burst by dropping
   * connections for minutes rather than returning 429.
   */
  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.config.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      await this.awaitPolitenessGate();
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  /** Reserves the next start slot and waits for it. */
  private async awaitPolitenessGate(): Promise<void> {
    const interval = this.config.minRequestIntervalMs;
    if (interval <= 0) return;
    const now = Date.now();
    const startAt = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = startAt + interval;
    if (startAt > now) await sleep(startAt - now);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
