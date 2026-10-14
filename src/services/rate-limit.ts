/**
 * Inbound rate limiting for the HTTP transport.
 *
 * A fixed one-minute window per key (the client IP). Kept free of Node and SDK
 * types so the rule can be unit-tested with an injected clock.
 *
 * The limit is per process and in memory. If the service is ever scaled out,
 * move the limit to the edge (Cloudflare) instead.
 */

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the window resets; 0 when allowed. */
  retryAfterSec: number;
}

export interface RateLimiterOptions {
  /** Requests allowed per window. `0` disables the limiter. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs?: number;
  /** Most keys tracked at once, so a flood of distinct IPs cannot grow memory. */
  maxKeys?: number;
}

interface Window {
  start: number;
  count: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(private readonly options: RateLimiterOptions) {
    this.windowMs = options.windowMs ?? 60_000;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  /** Number of keys currently tracked (for tests and health). */
  get size(): number {
    return this.windows.size;
  }

  check(key: string, now: number = Date.now()): RateDecision {
    if (this.options.limit <= 0) return { allowed: true, retryAfterSec: 0 };

    let win = this.windows.get(key);
    if (!win || now - win.start >= this.windowMs) {
      if (!win) this.makeRoom(now);
      win = { start: now, count: 0 };
      // Delete first so re-insertion moves the key to the newest position.
      this.windows.delete(key);
      this.windows.set(key, win);
    }

    win.count++;
    if (win.count <= this.options.limit) return { allowed: true, retryAfterSec: 0 };
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((win.start + this.windowMs - now) / 1000)),
    };
  }

  /** Prunes expired windows, then the oldest, until there is room for one more key. */
  private makeRoom(now: number): void {
    if (this.windows.size < this.maxKeys) return;
    for (const [key, win] of this.windows) {
      if (now - win.start >= this.windowMs) this.windows.delete(key);
    }
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
