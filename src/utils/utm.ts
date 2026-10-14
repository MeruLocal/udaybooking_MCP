import { ALLOWED_HOSTS } from "../constants.js";

/**
 * Tags an own-site URL so traffic from AI agents is visible in the site's
 * analytics: `utm_source=mcp&utm_medium=ai_agent&utm_campaign=<tool>`.
 *
 * - Only URLs on `ALLOWED_HOSTS` are tagged; anything else is returned as is.
 * - Existing query parameters and the fragment are kept.
 * - An existing `utm_*` value is never overwritten, so tagging is idempotent.
 *
 * Apply it to URLs in tool *output* only, never to URLs used for fetching or
 * as cache keys.
 */
export function withUtm(url: string, tool: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) return url;

  const tags: [string, string][] = [
    ["utm_source", "mcp"],
    ["utm_medium", "ai_agent"],
    ["utm_campaign", tool],
  ];
  for (const [key, value] of tags) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}
