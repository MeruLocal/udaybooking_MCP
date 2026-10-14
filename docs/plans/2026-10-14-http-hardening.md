# Plan: harden the HTTP transport for public hosting

- **Severity:** P1 (needed before exposing mcp.udaybooking.com)
- **Effort:** M

## Finding

`src/http.ts` was written for loopback use, but the target is a public endpoint behind Cloudflare and Apache.

- **No rate limit.** Any client can send unlimited requests, and each request can spend the origin's politeness budget (`UDAYBOOKING_MIN_REQUEST_INTERVAL_MS` / `MAX_CONCURRENCY` are global, so one client can starve everyone).
- **No session cap.** `openSession` (`src/http.ts:271-303`) creates an `McpServer` per `initialize`. The idle reaper (30 min) is the only bound.
- **No Host allowlist.** `src/http.ts:100` accepts any `Host`. The Origin check (`decideOrigin`) lets requests with no Origin through, so DNS rebinding of non-browser paths is only partly covered.
- **Discovery trusts forwarded headers.** `publicBase()` (`src/http.ts:355-360`) builds the advertised endpoint from `X-Forwarded-Host` / `X-Forwarded-Proto`. Any client can make `/.well-known/mcp.json` advertise a host it controls, and a caching proxy would then serve that response to everyone.
- Already fine: 1 MB body cap (`MAX_BODY_BYTES`), generic 500 message (`src/http.ts:90-94`), Origin check.

Measured: `audit-live-mcp.mjs` on main gave 2 fail · 3 warn · 15 pass. It has no rate-limit or Host checks, so this finding comes from reading the code.

## Proposed fix

New env settings (in `src/config.ts` and `.env.example`):

| Env | Default |
| --- | --- |
| `UDAYBOOKING_HTTP_RATE_LIMIT_PER_MIN` | `60` (0 disables) |
| `UDAYBOOKING_HTTP_MAX_SESSIONS` | `100` |
| `UDAYBOOKING_HTTP_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1],mcp.udaybooking.com` |
| `TRUST_PROXY` | `0` |
| `PUBLIC_BASE_URL` | unset (production: `https://mcp.udaybooking.com`) |

- `src/services/rate-limit.ts` (new): a fixed-window `RateLimiter.check(key, now)` that returns `{allowed, retryAfterSec}`, with a bounded key map that prunes expired windows and then the oldest.
- `src/services/http-policy.ts`:
  - `hostnameOf(host)` rejects userinfo, paths and queries.
  - `isAllowedHost(host, list)`.
  - `clientIp(remoteAddress, xff, trustProxy)` uses the right-most XFF hop only when `TRUST_PROXY=1`, otherwise the socket address.
- `src/http.ts` `handle()` order:
  1. Host allowlist → generic 403.
  2. Rate limit on every path except `/health` → 429 + `Retry-After`.
  3. The existing Origin check.
- In `openSession()`: when `sessions.size >= max`, return 503 + `Retry-After: 30`.
- `publicBase()`: use `PUBLIC_BASE_URL` if set; else `http://<allowlisted Host>`; else the bind address. Never read `X-Forwarded-*`.
- The Docker `HEALTHCHECK` hits `127.0.0.1`, which is allowlisted, so it keeps working.

## Tests to add

- Unit tests: limiter window, reset, `0` disables, bounded size. `isAllowedHost` with ports, IPv6, case, suffix tricks (`mcp.udaybooking.com.evil.example`) and userinfo. `clientIp` with and without trust. Config defaults, and empty `PUBLIC_BASE_URL` treated as unset.
- End to end: spawn `node --import tsx src/http.ts` on a free port. Check a foreign Host → 403; discovery URL = `PUBLIC_BASE_URL` despite `X-Forwarded-Host`; the third `initialize` with max=2 → 503; the limit bites → 429 while `/health` stays 200.
- Re-run `audit-live-mcp.mjs`; expect no regression.

## Risks, rollout, decisions

- **Deploy:** set `PUBLIC_BASE_URL` and `TRUST_PROXY=1` behind Cloudflare/Apache. Without `TRUST_PROXY`, all users share the proxy's IP bucket. With it set but no proxy in front, clients pick their own bucket.
- If Apache forwards a Host that is not on the list (for example a backend IP), requests are refused. Check `ProxyPreserveHost` or add that host.
- **Founder:** confirm the limits (60/min per IP, 100 sessions) for expected traffic.
- In-memory limits are per process. If the service is scaled out, move the limit to Cloudflare.
