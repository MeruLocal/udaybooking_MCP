/**
 * Error taxonomy. Every message is written for an LLM caller: it says what went
 * wrong, and what the caller should do differently next time.
 */

export type ErrorCode =
  | "INVALID_ARGUMENT"
  | "DISALLOWED_PATH"
  | "NOT_FOUND"
  | "UPSTREAM_UNAVAILABLE"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PARSE_FAILED"
  | "UNSUPPORTED_CAPABILITY";

export class UdayBookingError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly hint?: string;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { status?: number; hint?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "UdayBookingError";
    this.code = code;
    this.status = opts.status;
    this.hint = opts.hint;
    this.retryable = opts.retryable ?? false;
  }
}

export const invalidArgument = (message: string, hint?: string): UdayBookingError =>
  new UdayBookingError("INVALID_ARGUMENT", message, { hint });

export const notFound = (message: string, hint?: string): UdayBookingError =>
  new UdayBookingError("NOT_FOUND", message, { status: 404, hint });

export const disallowedPath = (message: string, hint?: string): UdayBookingError =>
  new UdayBookingError("DISALLOWED_PATH", message, { hint });

export const unsupported = (message: string, hint?: string): UdayBookingError =>
  new UdayBookingError("UNSUPPORTED_CAPABILITY", message, { hint });

/**
 * Renders any thrown value as a single actionable line for a tool result.
 * Tool handlers return this with `isError: true` rather than throwing, so the
 * model sees a usable message instead of a transport-level failure.
 */
export function formatError(error: unknown): string {
  if (error instanceof UdayBookingError) {
    const parts = [`Error [${error.code}]: ${error.message}`];
    if (error.status) parts.push(`HTTP status: ${error.status}.`);
    if (error.hint) parts.push(error.hint);
    if (error.retryable) parts.push("This condition is usually transient — retrying may succeed.");
    return parts.join(" ");
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}
