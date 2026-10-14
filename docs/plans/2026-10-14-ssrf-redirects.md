# Plan: close the SSRF redirect gap and pin exact hosts

- **Severity:** P1 (security)
- **Effort:** S

## Finding

- `src/services/http-client.ts:109-120` fetches with `redirect: "follow"`, then re-checks `res.url` after the fact. By then the off-host hop has already been requested, so the check stops the server *returning* the content but not *fetching* it. That is a server-side request forgery (SSRF) gap: if any allowed page redirects to an internal or third-party address, the server fetches that address.
- `src/services/http-client.ts:68` allows `host === "udaybooking.com" || host.endsWith(".udaybooking.com")`. That covers any subdomain, including ones that point at third-party infrastructure (`app.`, and future ones).
- Only the final URL is checked. Intermediate hops are never checked against host, protocol or robots rules.
- (Re-audit) **No response size cap.** `src/services/http-client.ts:146` reads `await res.text()` with no length guard, so one oversized or endless upstream response is buffered whole into memory. Skill §4 S2 requires a cap alongside the redirect re-check. The timeout (`requestTimeoutMs`, 15 s) is the only bound today.

Measured: the existing tests pass on main (153/153). None of them covers redirects. The live site was not reachable from the sandbox, so its real redirect behaviour (apex ↔ www, trailing slash) was not observed.

## Proposed fix

- `src/constants.ts`: add `ALLOWED_HOSTS = ["udaybooking.com", "www.udaybooking.com"]`.
- `HttpClient.resolveUrl`: check `ALLOWED_HOSTS.includes(hostname)` exactly.
- New private `fetchFollowingRedirects(startUrl, signal)`:
  ```
  current = startUrl
  for hop in 0..:
    res = fetch(current, {redirect: "manual", signal, headers})
    if res.status not in {301,302,303,307,308}: return {res, finalUrl: current}
    cancel res.body
    loc = res.headers.location   -> missing: UPSTREAM_UNAVAILABLE (not retryable)
    if hop >= MAX_REDIRECTS (5):  -> UPSTREAM_UNAVAILABLE (not retryable)
    current = resolveUrl(new URL(loc, current))   # host/protocol/robots check BEFORE fetching
  ```
- `attempt()` calls it instead of `fetch(..., {redirect: "follow"})` and returns `finalUrl` as `url`. Retry, timeout and status mapping are unchanged. A `DISALLOWED_PATH` error from a hop is not retryable.
- (Re-audit) **Body cap:** replace `res.text()` with a streamed read that stops at `UDAYBOOKING_MAX_RESPONSE_BYTES` (default 5 MB; reject early when `content-length` is larger) and throws `UPSTREAM_UNAVAILABLE` (not retryable). Test: a mock body above the cap is refused and the stream is cancelled.
- `UDAYBOOKING_BASE_URL` stays configurable, but a mirror on another host would now be refused. Document that (or allow the base URL's own host explicitly if staging is needed).

## Tests to add

`tests/http-client.test.ts`, with a new `redirects: Record<path, location>` option in `tests/mock-fetch.ts`:

- Same-host redirect `/old → /in/pricing` is followed, and `url` is the final URL.
- `www.udaybooking.com ↔ udaybooking.com` is followed.
- Redirect to `https://evil.example/`, `http://169.254.169.254/`, `https://app.udaybooking.com/` or `file:` is refused with `DISALLOWED_PATH`, and **the mock records no request to that host**.
- Redirect into `/api/...` is refused (robots).
- A redirect loop or more than 5 hops gives a clear error. A redirect with no Location gives a clear error.
- `resolveUrl("https://staging.udaybooking.com/")` is now refused. Update the existing "accepts ... subdomains" test name and assertions.

## Risks, rollout, decisions

- If the site redirects to a host other than apex/www (for example a CDN host), those pages will start failing. Before merging, check `curl -sI` on a few live URLs from a machine that can reach the site.
- **Founder:** confirm no other udaybooking subdomain (docs., help.) needs to be readable.
