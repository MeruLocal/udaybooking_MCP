/**
 * In-memory per-tool usage counters for `/health`: calls, errors and latency
 * percentiles over the most recent calls. Counts only — no arguments and no
 * client names are stored. Reset on restart.
 */

export interface ToolUsage {
  calls: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
}

interface Bucket {
  calls: number;
  errors: number;
  /** Ring of the most recent durations, in milliseconds. */
  recent: number[];
  next: number;
}

export class UsageStats {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly window = 200) {}

  record(tool: string, ok: boolean, ms: number): void {
    let b = this.buckets.get(tool);
    if (!b) {
      b = { calls: 0, errors: 0, recent: [], next: 0 };
      this.buckets.set(tool, b);
    }
    b.calls++;
    if (!ok) b.errors++;
    if (b.recent.length < this.window) {
      b.recent.push(ms);
    } else {
      b.recent[b.next] = ms;
      b.next = (b.next + 1) % this.window;
    }
  }

  snapshot(): Record<string, ToolUsage> {
    const out: Record<string, ToolUsage> = {};
    for (const [tool, b] of [...this.buckets].sort(([a], [z]) => a.localeCompare(z))) {
      const sorted = [...b.recent].sort((x, y) => x - y);
      out[tool] = {
        calls: b.calls,
        errors: b.errors,
        p50_ms: percentile(sorted, 0.5),
        p95_ms: percentile(sorted, 0.95),
      };
    }
    return out;
  }
}

/** Nearest-rank percentile of an ascending array (0 when empty). */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/**
 * A client name safe to log: at most 64 characters of `[A-Za-z0-9 ._-]`.
 * `clientInfo.name` is chosen by the client, so it is treated as untrusted.
 */
export function sanitizeClientName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const clean = name.replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 64).trim();
  return clean === "" ? undefined : clean;
}
