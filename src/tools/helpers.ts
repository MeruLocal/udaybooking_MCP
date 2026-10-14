import { CHARACTER_LIMIT, INTERNATIONAL, SITE_ORIGIN } from "../constants.js";
import { formatError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";

/**
 * Shape the MCP SDK expects back from a tool handler.
 *
 * The index signature is required: the SDK's `CallToolResult` permits arbitrary
 * extra fields, so a closed interface is not assignable to it.
 */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Builds the path prefix for a market. `international` has no prefix, which is
 * how the unprefixed edition of the site is published.
 */
export function marketPrefix(market: string): string {
  return market === INTERNATIONAL ? "" : `/${market}`;
}

/** Absolute URL for a market-scoped path, e.g. ('in', '/pricing') -> /in/pricing. */
export function marketUrl(market: string, suffix: string): string {
  const path = `${marketPrefix(market)}${suffix}`;
  return `${SITE_ORIGIN}${path === "" ? "/" : path}`;
}

/**
 * Trims text to a budget on a word boundary, appending an explicit note so the
 * model knows content was withheld rather than absent.
 */
export function clamp(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean; originalLength: number } {
  const originalLength = text.length;
  if (originalLength <= maxChars) return { text, truncated: false, originalLength };

  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf("\n");
  const body = lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak) : cut;

  return {
    text: `${body.trimEnd()}\n\n[Truncated: showing ${body.length} of ${originalLength} characters. Raise max_chars, or request a more specific page, to see the rest.]`,
    truncated: true,
    originalLength,
  };
}

/**
 * Final guard on response size. Applied to the text block of every tool result
 * so no single call can flood a client's context.
 */
export function enforceCharacterLimit(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return `${text.slice(0, CHARACTER_LIMIT - 200).trimEnd()}\n\n[Response truncated at ${CHARACTER_LIMIT} characters. Narrow the request — use a filter, a lower limit, or a specific path.]`;
}

/** Builds a successful tool result, enforcing the response size limit. */
export function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: enforceCharacterLimit(text) }],
    structuredContent: structured,
  };
}

/** Builds an error tool result carrying an actionable message. */
export function fail(error: unknown): ToolResult {
  return {
    content: [{ type: "text", text: enforceCharacterLimit(formatError(error)) }],
    isError: true,
  };
}

/**
 * Wraps a handler so a thrown error becomes an `isError` result rather than a
 * transport failure, and every call is logged to stderr with its duration.
 */
export function guard<A>(
  logger: Logger,
  toolName: string,
  handler: (args: A) => Promise<ToolResult>,
): (args: A) => Promise<ToolResult> {
  return async (args: A): Promise<ToolResult> => {
    const started = Date.now();
    try {
      const result = await handler(args);
      logger.debug("tool completed", { tool: toolName, ms: Date.now() - started });
      return result;
    } catch (error) {
      logger.warn("tool failed", {
        tool: toolName,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  };
}

/** Renders a Markdown bullet list, skipping empty values. */
export function bullets(pairs: [string, string | number | undefined][]): string {
  return pairs
    .filter((pair): pair is [string, string | number] => pair[1] !== undefined && pair[1] !== "")
    .map(([label, value]) => `- **${label}**: ${value}`)
    .join("\n");
}
