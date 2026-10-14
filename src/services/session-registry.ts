/**
 * Session bookkeeping for the HTTP transport.
 *
 * This exists because an MCP client is not obliged to tell the server it has
 * gone. The spec says a client *should* send `DELETE /mcp` to end a session, but
 * closing a client transport does not do so, and a crashed or disconnected
 * client never will. Without expiry, a long-running HTTP server accumulates one
 * `McpServer` per client that ever connected — a slow leak that also inflates
 * the session count reported by `/health`.
 *
 * Kept in its own module, free of any HTTP or SDK types, so the expiry rule can
 * be unit-tested without binding a port.
 */

export interface SessionLike {
  /** Releases the session's transport and server. */
  close(): Promise<void>;
}

interface Entry<S extends SessionLike> {
  session: S;
  createdAt: number;
  lastSeenAt: number;
}

export interface SessionRegistryOptions {
  /** Idle time after which a session is reaped, in milliseconds. */
  idleTtlMs: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export class SessionRegistry<S extends SessionLike> {
  private readonly entries = new Map<string, Entry<S>>();
  private readonly now: () => number;

  constructor(private readonly options: SessionRegistryOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  add(id: string, session: S): void {
    const ts = this.now();
    this.entries.set(id, { session, createdAt: ts, lastSeenAt: ts });
  }

  /** Returns the session and marks it as recently used. */
  touch(id: string): S | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    entry.lastSeenAt = this.now();
    return entry.session;
  }

  /** Returns the session without affecting its idle timer. */
  peek(id: string): S | undefined {
    return this.entries.get(id)?.session;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Forgets a session without closing it (for use from a close callback). */
  forget(id: string): boolean {
    return this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Ids whose idle time has exceeded the TTL. */
  idleIds(): string[] {
    const cutoff = this.now() - this.options.idleTtlMs;
    const stale: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.lastSeenAt <= cutoff) stale.push(id);
    }
    return stale;
  }

  /**
   * Closes and removes every idle session, returning the ids reaped. A failure
   * to close is swallowed: the entry is dropped regardless, since the point is
   * to stop holding it.
   */
  async reapIdle(): Promise<string[]> {
    const stale = this.idleIds();
    await Promise.allSettled(
      stale.map(async (id) => {
        const entry = this.entries.get(id);
        this.entries.delete(id);
        if (entry) await entry.session.close();
      }),
    );
    return stale;
  }

  /** Closes and removes every session, for shutdown. */
  async closeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(all.map((entry) => entry.session.close()));
  }
}
