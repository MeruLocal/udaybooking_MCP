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
