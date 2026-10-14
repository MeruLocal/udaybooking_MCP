import { afterEach, describe, expect, it, vi } from "vitest";
import { percentile, sanitizeClientName, UsageStats } from "../src/services/usage.js";
import { guard, ok, withTelemetry } from "../src/tools/helpers.js";
import { createLogger } from "../src/utils/logger.js";
import { notFound } from "../src/utils/errors.js";

describe("UsageStats", () => {
  it("counts calls and errors and reports nearest-rank percentiles", () => {
    const stats = new UsageStats();
    for (let ms = 1; ms <= 100; ms++) stats.record("t", ms % 10 !== 0, ms);
    expect(stats.snapshot()).toEqual({ t: { calls: 100, errors: 10, p50_ms: 50, p95_ms: 95 } });
  });

  it("keeps latencies for the most recent calls only", () => {
    const stats = new UsageStats(3);
    for (const ms of [1000, 1000, 1000, 1, 2, 3]) stats.record("t", true, ms);
    expect(stats.snapshot().t).toMatchObject({ calls: 6, p50_ms: 2, p95_ms: 3 });
  });

  it("percentile of an empty set is 0", () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("sanitizeClientName", () => {
  it("keeps safe characters and truncates to 64", () => {
    expect(sanitizeClientName("claude-ai <script>")).toBe("claude-ai script");
    expect(sanitizeClientName("x".repeat(100))?.length).toBe(64);
    expect(sanitizeClientName("")).toBeUndefined();
    expect(sanitizeClientName("\u0000\u0001")).toBeUndefined();
  });
});

describe("guard() usage line", () => {
  let lines: string[] = [];
  afterEach(() => {
    lines = [];
    vi.restoreAllMocks();
  });

  function capture(): void {
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
  }

  const usageLines = () =>
    lines.map((l) => JSON.parse(l) as { level: string; msg: string; ctx: Record<string, unknown> })
      .filter((l) => l.msg === "tool call");

  it("emits exactly one info line per call, with tool, ok, ms and client", async () => {
    capture();
    const usage = new UsageStats();
    const logger = withTelemetry(createLogger({ logLevel: "info" }), {
      usage,
      clientName: () => "Test Client/1.0",
      logCalls: true,
    });
    const handler = guard(logger, "udaybooking_x", async () => ok("hi", {}));
    await handler({ query: "jane@example.com" });

    const calls = usageLines();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe("info");
    expect(calls[0]?.ctx).toMatchObject({ tool: "udaybooking_x", ok: true, client: "Test Client1.0" });
    expect(typeof calls[0]?.ctx.ms).toBe("number");
    expect(usage.snapshot().udaybooking_x?.calls).toBe(1);
  });

  it("on failure logs the error code but neither the message nor the arguments", async () => {
    capture();
    const logger = withTelemetry(createLogger({ logLevel: "info" }), { logCalls: true });
    const handler = guard(logger, "udaybooking_x", async () => {
      throw notFound("No page for jane@example.com");
    });
    const result = await handler({ query: "jane@example.com" });
    expect(result.isError).toBe(true);

    const calls = usageLines();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ctx).toMatchObject({ ok: false, error_code: "NOT_FOUND" });
    expect(lines.join("\n")).not.toContain("jane@example.com");
  });

  it("emits no usage line when UDAYBOOKING_USAGE_LOG is off", async () => {
    capture();
    const logger = withTelemetry(createLogger({ logLevel: "info" }), { logCalls: false });
    await guard(logger, "udaybooking_x", async () => ok("hi", {}))({});
    expect(usageLines()).toHaveLength(0);
  });
});
