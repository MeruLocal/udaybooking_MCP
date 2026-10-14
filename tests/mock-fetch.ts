import { vi } from "vitest";
import { ROUTES } from "./fixtures.js";

export interface MockOptions {
  /** Paths that should return the given status instead of content. */
  statusByPath?: Record<string, number>;
  /** Paths whose first N attempts fail at the network level, then succeed. */
  flakyPaths?: Record<string, number>;
  /** Paths that never resolve, to exercise the timeout path. */
  hangingPaths?: string[];
  /** Paths that answer with a redirect to the given Location (`null` = no header). */
  redirects?: Record<string, string | null>;
  /** Paths that stream the given number of bytes, without a content-length. */
  oversized?: Record<string, number>;
  /** Paths that declare the given content-length (body is tiny). */
  declaredLength?: Record<string, number>;
}

export interface MockHandle {
  /** How many requests were made, by path. */
  calls: string[];
  /** Every requested URL, in full (host included). */
  urls: string[];
  /** Paths whose streamed body was cancelled by the client. */
  cancelled: string[];
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
  const urls: string[] = [];
  const cancelled: string[] = [];
  const attempts = new Map<string, number>();

  const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "");
    calls.push(path || "/");
    urls.push(url.toString());

    if (url.hostname !== "udaybooking.com" && url.hostname !== "www.udaybooking.com") {
      // Reaching here means the client let a request leave the allowed hosts.
      return new Response("off-host", { status: 200, headers: { "content-type": "text/plain" } });
    }

    if (options.redirects && path in options.redirects) {
      const location = options.redirects[path];
      const headers = new Headers();
      if (location !== null && location !== undefined) headers.set("location", location);
      return new Response(null, { status: 302, headers });
    }

    const oversized = options.oversized?.[path];
    if (oversized !== undefined) {
      let sent = 0;
      const chunk = new Uint8Array(64 * 1024).fill(97);
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= oversized) return controller.close();
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled.push(path);
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/html" } });
    }

    const declared = options.declaredLength?.[path];
    if (declared !== undefined) {
      return new Response("<p>x</p>", {
        status: 200,
        headers: { "content-type": "text/html", "content-length": String(declared) },
      });
    }

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
    urls,
    cancelled,
    restore() {
      globalThis.fetch = original;
    },
  };
}
