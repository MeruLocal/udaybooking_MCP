import type { Config } from "../config.js";
import type { Logger } from "../utils/logger.js";
import {
  ALLOWED_HOST,
  ALLOWED_HOSTS,
  MAX_REDIRECTS,
  ROBOTS_DISALLOWED_PREFIXES,
} from "../constants.js";
import { UdayBookingError, disallowedPath, notFound } from "../utils/errors.js";

export interface FetchTextResult {
  url: string;
  status: number;
  body: string;
  fromCache: false;
}

/** Redirect statuses this client follows itself, one checked hop at a time. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Status codes worth another attempt: transient server and throttling errors. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

/**
 * HTTP client for the public site.
 *
 * Three things it guarantees, each of which exists for a reason observed during
 * analysis:
 *
 * 1. **Host pinning.** Only the exact hosts in `ALLOWED_HOSTS` (plus the
 *    configured base URL's host) are reachable. Tool arguments feed into URLs,
 *    so without this a caller could point the server at an arbitrary host and
 *    use it as a proxy. Redirects are followed manually and every hop is
 *    checked *before* it is requested, so a redirect cannot reach another host
 *    either. Response bodies are capped at `maxResponseBytes`.
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

  /** Exact hostnames that may be fetched. */
  private readonly allowedHosts: ReadonlySet<string>;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    // The operator-configured base URL's own host is allowed explicitly, so a
    // staging mirror keeps working. It is configuration, never a tool argument.
    const hosts = new Set(ALLOWED_HOSTS);
    try {
      hosts.add(new URL(config.baseUrl).hostname.toLowerCase());
    } catch {
      // loadConfig already validated the URL; nothing to add otherwise.
    }
    this.allowedHosts = hosts;
  }

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
    if (!this.allowedHosts.has(host)) {
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

    // Tracking parameters (including ones this server added to links it handed
    // out) never change page content; drop them so they are neither sent
    // upstream nor split the cache.
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
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
        const { res, finalUrl } = await this.fetchFollowingRedirects(url, controller.signal);

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

        const body = await this.readCapped(res, finalUrl);
        this.logger.debug("fetched", { url: finalUrl, status: res.status, bytes: body.length });
        return { url: finalUrl, status: res.status, body, fromCache: false };
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
   * Fetches `startUrl`, following redirects one hop at a time.
   *
   * `redirect: "follow"` would let the runtime request an off-host hop before
   * this code could see it (a server-side request forgery gap). Here each
   * `Location` goes through `resolveUrl` — host, protocol and robots checks —
   * before it is requested.
   */
  private async fetchFollowingRedirects(
    startUrl: string,
    signal: AbortSignal,
  ): Promise<{ res: Response; finalUrl: string }> {
    let current = startUrl;
    for (let hop = 0; ; hop++) {
      const res = await fetch(current, {
        redirect: "manual",
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en",
          "user-agent": this.config.userAgent,
        },
      });

      if (!REDIRECT_STATUS.has(res.status)) return { res, finalUrl: current };

      await res.body?.cancel().catch(() => undefined);
      const location = res.headers.get("location");
      if (!location) {
        throw new UdayBookingError(
          "UPSTREAM_UNAVAILABLE",
          `udaybooking.com answered ${current} with a redirect (${res.status}) but no Location.`,
          { status: res.status, retryable: false },
        );
      }
      if (hop >= MAX_REDIRECTS) {
        throw new UdayBookingError(
          "UPSTREAM_UNAVAILABLE",
          `Too many redirects (more than ${MAX_REDIRECTS}) starting from ${startUrl}.`,
          { status: res.status, retryable: false, hint: "The page may be in a redirect loop." },
        );
      }

      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        throw new UdayBookingError(
          "UPSTREAM_UNAVAILABLE",
          `udaybooking.com redirected ${current} to an invalid location.`,
          { status: res.status, retryable: false },
        );
      }
      // Throws DISALLOWED_PATH (not retryable) for an off-host, non-http or
      // robots-disallowed hop, before anything is sent to it.
      current = this.resolveUrl(next);
    }
  }

  /**
   * Reads a response body as text, refusing anything above `maxResponseBytes`.
   * A declared `content-length` above the cap is refused without reading.
   */
  private async readCapped(res: Response, url: string): Promise<string> {
    const cap = this.config.maxResponseBytes;
    const tooLarge = (): UdayBookingError =>
      new UdayBookingError(
        "UPSTREAM_UNAVAILABLE",
        `The response for ${url} is larger than ${cap} bytes and was not read.`,
        { retryable: false, hint: "Raise UDAYBOOKING_MAX_RESPONSE_BYTES if this page is legitimately large." },
      );

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > cap) {
      await res.body?.cancel().catch(() => undefined);
      throw tooLarge();
    }
    if (!res.body) return "";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
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
