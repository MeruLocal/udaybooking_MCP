# Plan: record tool usage (name, client, latency, outcome) without arguments

- **Severity:** P2 (business visibility; skill §4 V4, C18.usage)
- **Effort:** S

## Finding

- Once `mcp.udaybooking.com` is public, nobody will be able to say which tools are used, by which clients, how often they fail or how slow they are.
- `guard()` (`src/tools/helpers.ts:83-103`) logs a successful call only at **debug** (`:92`), which is off at the default `info` level (`src/config.ts`, `Dockerfile` `UDAYBOOKING_LOG_LEVEL=info`). Failures log at warn (`:95-99`) with the error message.
- No log line carries the client name (`clientInfo.name` from `initialize`), the session, or the transport.
- `/health` reports sessions and cache size, but no per-tool counters.

Measured: `audit-live-mcp.mjs` (2026-10-14, local scratch build) has no usage check; the server log during the run (level `warn`) showed tool failures only. This finding comes from reading the code.

## Proposed fix

1. **`guard()`**: emit one `info` line per call, `msg: "tool call"`, with `tool`, `ok` (boolean), `ms`, `error_code` (the `UdayBookingError.code` on failure, never the message), and `client` (see 2). **Never log arguments**: queries and paths can carry personal text.
2. **Client name:** pass a getter into `buildServer` so tools can read `server.server.getClientVersion()?.name` (the SDK stores `clientInfo` after `initialize`). Truncate to 64 chars and strip anything outside `[A-Za-z0-9 ._-]`.
3. **Counters:** a small in-memory `UsageStats` (`src/services/usage.ts`): per tool `calls`, `errors`, `p50/p95 ms` over the last N calls. Expose it on `/health` as `usage` (counts only, no client names), reset on restart.
4. **Config:** `UDAYBOOKING_USAGE_LOG=1` (default on); `0` turns the per-call line off for anyone who cannot store logs.
5. Shipping these logs anywhere (a database, analytics) is out of scope. stdout/stderr collection by the host is enough for now.

## Tests to add

- `helpers.test.ts`: `guard()` emits exactly one `tool call` line at info with `ok`, `ms`, `tool`; on failure it has `error_code` and no `error` message; a call with `query: "jane@example.com"` produces a log line that does not contain it.
- `usage.test.ts`: counters and percentiles over a fixed sequence.
- `/health` includes `usage` with counts only.

## Risks, rollout, decisions

- Log volume: one line per tool call. At expected traffic this is small; the env switch covers the rest.
- **Founder:** where should usage end up long term (host logs only, or the admin's MCP Center)? The plan stops at logs and `/health`.
