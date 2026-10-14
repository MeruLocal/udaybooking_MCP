/**
 * Request-classification and origin policy for the HTTP transport.
 *
 * Pure functions, free of Node and SDK types, so the security-relevant rules can
 * be unit-tested directly rather than inferred from a running server.
 */

/** The subset of request headers these decisions depend on. */
export interface HeaderBag {
  accept?: string | undefined;
  origin?: string | undefined;
  secFetchMode?: string | undefined;
  secFetchDest?: string | undefined;
}

/**
 * True when a request is a person navigating to the URL in a browser, rather
 * than an MCP client speaking the protocol.
 *
 * Worth distinguishing: `/mcp` is a JSON-RPC endpoint, so a browser GET can
 * never carry a session id and would otherwise be answered with a bare
 * "Missing Mcp-Session-Id header" — technically correct and completely
 * unhelpful to someone who just pasted the URL into their address bar.
 *
 * Detection uses `Sec-Fetch-Mode: navigate` / `Sec-Fetch-Dest: document`, which
 * browsers send on address-bar navigation and which scripted `fetch` cannot
 * forge, falling back to an `Accept` header that asks for HTML but not for an
 * event stream.
 */
export function isBrowserNavigation(headers: HeaderBag): boolean {
  if (headers.secFetchMode === "navigate") return true;
  if (headers.secFetchDest === "document") return true;

  const accept = headers.accept ?? "";
  return accept.includes("text/html") && !accept.includes("text/event-stream");
}

/** Loopback hosts whose browser origins are trusted by default. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * True when `origin` is a page served from this machine's loopback interface.
 *
 * These are allowed by default, and doing so does **not** weaken DNS-rebinding
 * protection. In a rebinding attack the attacker's page is served from their own
 * domain (which merely *resolves* to 127.0.0.1), so the browser sends
 * `Origin: https://attacker.example` — still rejected. Only a page genuinely
 * served from your own loopback interface carries a loopback origin, and an
 * attacker who can do that already has code running on your machine.
 *
 * The practical gain is large: the MCP Inspector, and any local web client, work
 * without turning the check off wholesale.
 */
export function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

export interface OriginDecision {
  allowed: boolean;
  /** Why it was allowed or refused, for logs and the error body. */
  reason: "no-origin" | "loopback" | "configured" | "not-allowed";
}

/**
 * Decides whether a request's `Origin` may drive this server.
 *
 * - No `Origin` at all → allowed. Every ordinary MCP client, and curl, is in
 *   this category; `Origin` is a browser construct.
 * - A loopback origin → allowed, for the reason given on `isLoopbackOrigin`.
 * - An origin in `allowList` → allowed.
 * - Anything else → refused, which is what stops a web page you happen to be
 *   visiting from driving this server through your browser.
 */
export function decideOrigin(
  origin: string | undefined,
  allowList: readonly string[],
  allowLoopback = true,
): OriginDecision {
  if (origin === undefined || origin === "" || origin === "null") {
    return { allowed: true, reason: "no-origin" };
  }
  if (allowList.includes(origin)) {
    return { allowed: true, reason: "configured" };
  }
  if (allowLoopback && isLoopbackOrigin(origin)) {
    return { allowed: true, reason: "loopback" };
  }
  return { allowed: false, reason: "not-allowed" };
}

/**
 * The hostname part of a `Host` header, lower-cased, without the port.
 *
 * Returns `undefined` for anything that is not a bare host[:port] — userinfo,
 * paths, queries and fragments are refused rather than parsed around, because a
 * lenient parser is exactly what a Host-header trick relies on.
 */
export function hostnameOf(host: string | undefined): string | undefined {
  if (host === undefined) return undefined;
  const value = host.trim().toLowerCase();
  if (value === "" || /[@/?#\s\\]/.test(value)) return undefined;

  // Bracketed IPv6, optionally with a port.
  const v6 = /^(\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/.exec(value);
  if (v6) return v6[1] ?? undefined;

  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(value);
  if (!m) return undefined;
  return (m[1] ?? "").replace(/\.$/, "") || undefined;
}

/** True when the request's `Host` header names an allowlisted hostname exactly. */
export function isAllowedHost(host: string | undefined, allowList: readonly string[]): boolean {
  const name = hostnameOf(host);
  if (name === undefined) return false;
  return allowList.some((entry) => entry.toLowerCase() === name);
}

/**
 * The client IP used as the rate-limit key.
 *
 * `trustProxyHops` is the number of trusted proxies in front of this server
 * (`TRUST_PROXY`). The client is the `X-Forwarded-For` entry at position
 * `len - hops` counted from the right (1-based), because each trusted proxy
 * appends the address it saw and a client can only prepend entries on the left.
 * With 0 hops, or a header shorter than the hop count, the socket address is
 * used, so a client cannot pick its own bucket. `CF-Connecting-IP` is never
 * trusted.
 */
export function clientIp(
  remoteAddress: string | undefined,
  xff: string | undefined,
  trustProxyHops: number,
): string {
  if (trustProxyHops > 0 && xff) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = hops.length - trustProxyHops;
    const hop = idx >= 0 ? hops[idx] : undefined;
    if (hop) return hop;
  }
  return remoteAddress ?? "unknown";
}

/** True for a bind address that is only reachable from this machine. */
export function isLoopbackBind(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase()) || host.startsWith("127.");
}
