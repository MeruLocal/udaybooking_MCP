import type { Config } from "../config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
export type LogLevel = keyof typeof LEVELS;

/** Keys whose values are replaced wholesale if they ever appear in log context. */
const SENSITIVE_KEY = /(pass|secret|token|cookie|auth|key|credential|session|bearer)/i;

/** Query parameters stripped from any URL before it reaches a log line. */
const SENSITIVE_QUERY = /^(token|key|api_key|apikey|access_token|password|secret|sig|signature)$/i;

/**
 * Removes a URL's credentials and sensitive query values so a logged URL can
 * never carry a secret, even if one is passed in by mistake.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username) u.username = "***";
    if (u.password) u.password = "***";
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(k)) u.searchParams.set(k, "***");
    }
    return u.toString();
  } catch {
    return raw;
  }
}

/** Recursively redacts sensitive keys, long strings and URLs in log context. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (typeof value === "string") {
    const s = /^https?:\/\//i.test(value) ? redactUrl(value) : value;
    return s.length > 500 ? `${s.slice(0, 500)}…[truncated]` : s;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "***redacted***" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

/**
 * Structured JSON logger that writes to **stderr only**.
 *
 * This is a hard requirement of the stdio transport: stdout carries MCP protocol
 * frames, so a single stray `console.log` would corrupt the session.
 */
export function createLogger(config: Pick<Config, "logLevel">): Logger {
  const threshold = LEVELS[config.logLevel as LogLevel] ?? LEVELS.info;

  const emit = (level: LogLevel, msg: string, ctx?: Record<string, unknown>): void => {
    if (LEVELS[level] < threshold) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      logger: "udaybooking-mcp-server",
      msg,
      ...(ctx ? { ctx: redact(ctx) as Record<string, unknown> } : {}),
    };
    try {
      process.stderr.write(`${JSON.stringify(line)}\n`);
    } catch {
      /* never let logging break a tool call */
    }
  };

  return {
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
  };
}
