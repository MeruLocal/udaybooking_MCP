import { vi } from "vitest";
import { ROUTES } from "./fixtures.js";

export interface MockOptions {
  /** Paths that should return the given status instead of content. */
  statusByPath?: Record<string, number>;
  /** Paths whose first N attempts fail at the network level, then succeed. */
  flakyPaths?: Record<string, number>;
  /** Paths that never resolve, to exercise the timeout path. */
  hangingPaths?: string[];
}

export interface MockHandle {
  /** How many requests were made, by path. */
  calls: string[];
  restore(): void;
}

/**
 * Replaces global fetch with a fixture-backed stub.
 *
 * No test in this suite touches the network: the live site is someone else's
 * property, its content changes, and a unit suite that depends on it is not a
 * unit suite. The live end-to-end check lives in `scripts/smoke.mjs` instead.
 */
export function mockFetch(options: MockOptions = {}): MockHandle {
  const calls: string[] = [];
  const attempts = new Map<string, number>();

  const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "");
    calls.push(path || "/");

    if (options.hangingPaths?.includes(path)) {
      // Resolve only when the caller's AbortSignal fires, so the client's
      // timeout is what ends the request — exactly as a real hang behaves.
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // never settles
        signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }

    const flakyBudget = options.flakyPaths?.[path];
    if (flakyBudget !== undefined) {
      const seen = attempts.get(path) ?? 0;
      attempts.set(path, seen + 1);
      if (seen < flakyBudget) {
        throw new TypeError("fetch failed");
      }
    }

    const forcedStatus = options.statusByPath?.[path];
    if (forcedStatus !== undefined) {
      return new Response(`status ${forcedStatus}`, {
        status: forcedStatus,
        headers: { "content-type": "text/plain" },
      });
    }

    const body = ROUTES[path];
    if (body === undefined) {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/html" } });
    }

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": path.endsWith(".xml")
          ? "application/xml"
          : path.endsWith(".txt")
            ? "text/plain"
            : "text/html; charset=utf-8",
      },
    });
  });

  const original = globalThis.fetch;
  globalThis.fetch = stub as unknown as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}
