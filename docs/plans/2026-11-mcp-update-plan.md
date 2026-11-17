# Plan: UdayBooking MCP update from the 2026-11 site research

Status: **plan only**. No code, tool or README change is made by this PR. A human merges.
Date: 2026-11-17.

Inputs (pinned, because the research session may still be adding commits):

| Input | Repo / path | Commit |
|---|---|---|
| MCP update brief | site repo `udaybooking`, branch `research/loops-2026-11`, `docs/research/mcp-update-brief.md` | `3c422f7` (branch tip when read: `bb52d49`) |
| Market page plan | same branch, `docs/research/pages/market-page-plan-2026-11.md` + `market-page-inventory.csv` (603 rows) | `c4234bc` |
| Claim register | same branch, `docs/research/claims.csv` | tip `bb52d49` |
| Site research PR | site repo PR #29 | open |
| This repo | `origin/main` | `e20b859` |

If the brief changes after `3c422f7`, re-read it and fold the delta in before building.

---

## 1. Claim / Mechanism / Observable / Risk

| | |
|---|---|
| **Claim** | Assistants answer scheduling-buyer questions about UdayBooking correctly (Free vs Professional, trial, SMS, WhatsApp, Teams, Zoom, markets, consent rules) when the MCP serves records from the same source of truth as the site, each with status, `last_verified` and `publication_status`. |
| **Mechanism** | Add a generated record layer from the site's `lib/pricing.ts`, `lib/markets.ts`, `lib/integrations.ts`, `lib/content.ts`, the claim register and the market-page inventory. Keep the live-site reader as a fallback and parity check. Read the sitemap index instead of three fixed children, and validate every canonical before listing it. |
| **Observable** | The 10-prompt eval (section 6) passes. A parity test fails when a served plan, price or integration status differs from the site. A canonical-check test fails when a listed URL does not resolve for a crawler user agent. |
| **Risk** | (a) Generalising channels the site holds as unverified (WhatsApp, weighted round robin) into "available". (b) Listing generated pages that production returns 404 for (audit L1). (c) Another product's name in the README and tool text. (d) Overlap with the eight open PRs (#12–#18, #20). |

## 2. Current server state (verified against `origin/main` at `e20b859`)

**Shape.** TypeScript, stdio + Streamable HTTP (port 3004), SSRF-guarded HTTP client with policy module, session registry, search index over `pages.xml`, `markets.xml` and `resources.xml`, JSON-LD parsing.

**Tools (8, read-only):** `udaybooking_get_site_summary`, `udaybooking_list_pages`, `udaybooking_get_page`, `udaybooking_search_content`, `udaybooking_get_pricing`, `udaybooking_get_faqs`, `udaybooking_list_markets`, `udaybooking_get_automation_capabilities`.

**Tests:** 9 test files under `tests/` (about 153 cases) plus `scripts/smoke.mjs` and `smoke-http.mjs`.

**In flight (open PRs, not on `main`):** #12 plan to stop hard-coding commercial claims; #13 plan to mark fetched content as untrusted; #14 usage analytics plan; #15 HTTP hardening and SSRF redirect gap; #16 official identity, registry metadata, no hard-coded commercial claims; #17 `udaybooking_get_started`, UTM links, prompts; #18 catalogue expiry, untrusted-content markers, argument-free usage logs; #20 index landing pages, server card, llms.txt on the MCP host. This plan sequences after them.

**Staleness and contradictions with the site:**

| # | MCP today | Site source of truth | Finding |
|---|---|---|---|
| U1 | README section 1: "reminders over WhatsApp, SMS and email" as a product feature | Claim C2: WhatsApp is "on request", wording unresolved; claim C1: SMS via the Twilio integration, plan availability to verify | MCP states two channels more broadly than the site's claim register allows |
| U2 | README: "Zoom and Google Meet locations" | Claim C4: Zoom needs the customer's own Marketplace app; C3: Microsoft Teams is not available | Zoom limit missing; Teams correctly absent but not stated as unavailable |
| U3 | README section 1 names the other product whose SPA shell the app host serves (3 places in README, 1 in `src/capabilities.ts`, 1 in `src/http.ts`) | Brand isolation; claim C10 (app-host branding, not re-verified) | A sister-product name is in the tree and in served tool text |
| U4 | HTTP footer: "unofficial, not affiliated with udaybooking" | Official knowledge layer; legal entity Soor LLC (claim C11: not yet on the site) | Contradicts target identity (#16 starts this) |
| U5 | `udaybooking_get_faqs` reads `FAQPage` JSON-LD (22 on `/help`, 9 on `/pricing`) | FAQPage markup is off (SEO decision 1) | Breaks once the site removes it |
| U6 | Catalogue from three fixed child sitemaps; README "417 URLs" literal (2026-10-13) | Site plan PR #28 §9 and audit L1: generated families outside those sitemaps; sampled generated pages return 404 in production | MCP sees a subset and could list URLs that do not resolve |
| U7 | `MARKET_CODES` = in, us, gb, au, nz, sg, ae | `lib/markets.ts`: same seven English editions; hreflang cluster of 9 (`en`, seven `en-XX`, `x-default`); market plan adds CA, DE, FR, IT, JP | Consistent today; hand-written, so it will drift; CA/DE/FR/IT/JP missing |
| U8 | Prices read live from JSON-LD offers (USD and INR) | `lib/pricing.ts`: Free (1 user, no card, no expiry); Professional $10 / $8 annual, INR 899 / 719, 1–100 users, 14-day trial no card; Enterprise quoted | Consistent today (read live); no as-of date on results |
| U9 | No SOC 2 statement | Standing founder fact, plain "SOC 2" only (C9) | Nothing to serve yet |
| U10 | No weighted round robin statement | C17: not verified | Must stay withheld |

## 3. Target contract: a public read-only knowledge layer

**Principles.** Read-only; it cannot make bookings and holds no account data. One source of truth: the site modules and claim register, copied at a recorded commit. Only `verified_public` records are served. A fetch or parse failure returns an error, never a remembered value.

**Tools (2 retrieval + 8 verb-entity), names as in the brief.** Each description states what / when / returns / not-for.

| Tool | What | When to use | Returns | Not for |
|---|---|---|---|---|
| `search` | Ranked search over served records, optional `market` | First call | top N `{id, type, title, canonical_url, market, status}` | Account data; unpublished pages |
| `fetch` | One record by id | To cite | full record | Arbitrary URLs |
| `get_plan` | One plan (Free, Professional, Enterprise) | "What does Free include" | `plan` | Quotes, discounts |
| `compare_plans` | All plans side by side | "Free vs Professional" | `plan[]` + `feature_matrix` | Competitor prices |
| `list_features` | Features, optional `plan` filter | "What can it do on Free" | `feature[]` | Roadmap promises |
| `get_integration_status` | One integration in one market | "Does it send SMS / work with Zoom / Teams" | `integration_status` | Claims beyond the register |
| `get_claim_status` | One claim by id with allowed wording | SOC 2, WhatsApp, round robin | `claim` | Widening a claim |
| `get_consent_rule` | Consent rule for a market and channel | "Rules for SMS reminders in Canada" | `consent_rule` | Legal advice; any figure without source and Astra check |
| `get_comparison` | Dated comparison rows (English markets only) | "X vs UdayBooking" | `comparison` | Prices, verdicts, non-English markets |
| `list_markets` / `get_page` | Markets with alternates; resolve a canonical URL and its hreflang alternates | "Page on round robin in the US" | `market[]` / `page` | URLs that do not resolve |

The brief's per-family tools (`list_industry_guides`, `get_regional_facts`, `get_calendar_facts`, `search_resources`, `get_term`, `get_research_asset`) are served through `search` + `fetch` with a `type` filter in the first release, and promoted to named tools only if the eval shows assistants miss them. That keeps the named tool count at 10.

**Common record envelope (from the brief, section 3):**

```ts
{
  id: string;
  type: RecordType;
  title: string;
  market: "IN" | "US" | "GB" | "AU" | "NZ" | "SG" | "AE" | "CA" | "DE" | "FR" | "IT" | "JP" | "global";
  locale: string;
  canonical_url: Record<Locale, string>;
  alternates: { hreflang: string; url: string }[];
  status: "available" | "beta" | "integration" | "coming_soon" | "unavailable";
  last_verified: string;
  refresh_after: string;
  publication_status: "verified_public" | "draft" | "withheld";
  source: { ref: string; captured_on: string };   // repo symbol or official URL with date
  as_of?: string;          // regulated figures only
  refresh_date?: string;   // regulated figures only
  astra_check?: "passed" | "pending";
  source_commit: string;
}
```

**Output schemas.** Every tool declares an `outputSchema`; `structuredContent` validates against it. Fixed schemas, no free-form blobs.

## 4. Record types: one per page family

From `market-page-inventory.csv` (603 rows, 9 families) at `c4234bc`; mapping as in the market plan section 2:

| Page family (rows) | Record type | Fields beyond the envelope | Gate |
|---|---|---|---|
| `consent_reminder_law` (46) | `consent_rule` | `statute`, `regulator`, `channel`, `authority_url`, `as_of`, `refresh_date`, `not_legal_advice: true` | NEEDS-SOURCE+ASTRA; legal read |
| `service_industry` (158) | `industry_guide` | `industry`, `local_terms`, `regulator`, `typical_lengths_source` | NEEDS-DATA |
| `regional_guide` (72) | `regional_fact` | `region`, `difference_summary`, `source_url` | NEEDS-DATA; only where a real difference exists |
| `calendar_timezone_holiday` (54) | `calendar_fact` | `region`, `year`, `holidays_source`, `dst_rule`, `working_week` | NEEDS-DATA |
| `local_payment_calendar_integration` (33) | `integration_status` | `integration`, `market`, `limits`, `evidence_ref` | product truth per market (C3, C4, C8) |
| `template_calculator` (90) | `resource` | `kind` (template / calculator), `file_url`, `inputs[]`, `currency` | NEEDS-SOURCE+ASTRA where tax or currency inputs exist |
| `glossary` (108) | `glossary_term` | `term`, `market`, `usage_example` | NEEDS-DATA / NEEDS-ASTRA-REVIEW |
| `research_franchise` (27) | `research_asset` | `method`, `dataset_sources[]`, `period` | NEEDS-SOURCE+ASTRA |
| `competitor_alternative_english` (15) | `comparison` | `competitor`, `rows[]` with `source_url` and `captured_on` | English markets only; C12 approval |

**9 family record types.** Core types: `plan`, `feature`, `claim`, `market`, `page`.

## 5. Change proposals for existing content (proposals only; nothing is removed)

Founder rule: ask before removing anything.

| # | Proposal | Why |
|---|---|---|
| P1 | Replace the other product's name in README, `src/capabilities.ts` and `src/http.ts` with neutral wording ("the app host serves another product's shell, not udaybooking"); add an encoded deny-list guard over the tree and over tool output | U3 |
| P2 | Reword README channel claims to the claim register: SMS "via the Twilio integration, plan availability to verify"; WhatsApp "on request"; Zoom "needs your own Marketplace app"; Teams "not available" | U1, U2 |
| P3 | Serve WhatsApp and weighted round robin as `withheld` claim records until the founder confirms wording | U1, U10 |
| P4 | Read the sitemap index instead of three fixed children; validate each canonical with a crawler-UA request before listing; replace the "417 URLs" literal with a generated count | U6 |
| P5 | Read markets and hreflang alternates from `lib/markets.ts` and the hreflang registry | U7 |
| P6 | Add a non-JSON-LD FAQ source before FAQPage markup is removed | U5 |
| P7 | Ask the founder to approve an official identity naming Soor LLC in place of "unofficial, not affiliated" (#16 overlaps) | U4 |
| P8 | Add `last_verified` and `publication_status` to every existing tool result | brief |

## 6. Eval suite (from the brief, section 5)

Pass = correct tool, correct record, correct canonical URL, no invented fact.

| # | Prompt | Expected tool | Expected record | Expected URL / answer |
|---|---|---|---|---|
| 1 | What does the Free plan include? | `get_plan` | `plan: free` | `/pricing`; booking page, Google and Microsoft 365 sync, personal availability, email reminders; 1 user, no card, no expiry |
| 2 | How much is Professional per user per month and annually? | `get_plan` | `plan: professional` | `/pricing`; $10 monthly, $8 billed annually (INR 899 / 719) with as-of date |
| 3 | Is there a free trial and does it need a card? | `get_plan` | `plan: professional` trial | 14-day trial, no card |
| 4 | Does UdayBooking send SMS reminders and how? | `get_integration_status` | `integration_status: twilio-sms` | via the Twilio integration, plan availability to verify; never "all plans" |
| 5 | Can I book with Microsoft Teams links? | `get_integration_status` | `integration_status: microsoft-teams` | not available |
| 6 | Does it support weighted round robin? | `get_claim_status` | `claim: C17` (withheld) | not verified |
| 7 | Does UdayBooking have SOC 2? | `get_claim_status` | `claim: C9` | the plain statement "SOC 2"; no type, scope, date or auditor |
| 8 | Which markets have local pricing pages? | `list_markets` | `market[]` | IN, US, GB, AU, NZ, SG, AE editions with `/<market>/pricing` |
| 9 | Give me the page on round-robin scheduling in the US and its alternates. | `get_page` | `page` | US canonical plus hreflang alternates from the registry; only URLs that resolve |
| 10 | What consent rules apply to appointment reminders in Canada? | `get_consent_rule` | `consent_rule: CA` (withheld) | withheld until the sourced, Astra-checked record exists; no figure |

## 7. Security and MCP Registry readiness

- **No write or customer-action tools.** No booking, cancellation, availability lookup on a real calendar, sign-up or app access.
- All tools keep `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.
- SSRF protection, redirect re-validation, size limits and rate limits on any URL-taking tool (#15; site plan PR #28 §9 step 5).
- Fetched page text is marked untrusted for agents (#13, #18); record text never flows into tool descriptions.
- Usage logs record no arguments (#14, #18).
- **MCP Registry listing only after a security review.** #16 prepares metadata; nothing is submitted by this plan.

## 8. Sequencing and gates

| Step | Work | Gate |
|---|---|---|
| 0 | Land or close #15, #16, #18, #17, #20 (and decide #12–#14) | Human merge |
| 1 | P1 brand guard + P2 claim wording | Guard test green; no other-product name in tree or output |
| 2 | Record envelope + output schemas; sync from site modules | Parity test green against `lib/pricing.ts`, `lib/integrations.ts` |
| 3 | `search` + `fetch`; sitemap index + canonical validation | No listed URL returns 404 |
| 4 | Plan, feature, integration and claim tools | Eval 1–8 pass |
| 5 | `get_page`, `list_markets` with registry alternates | Eval 9 passes |
| 6 | Family records, English markets first; consent and calculator records last | Official dated source, blind Astra check, as-of and refresh dates; legal read for consent rules |
| 7 | DE, FR, IT, JP records | Astra review, sellability, support language |
| 8 | Security review, then Registry submission | Section 7 |

Dependency: the production 404s on generated families (audit L1) must be resolved on the site before any page record for those families is `verified_public`.

**Facts fixed by founder decisions (do not reopen):**

- **SOC 2:** plain wording "SOC 2" only. No type, scope, date or auditor.
- **Legal entity:** Soor LLC.
- **Regulated figures** (consent-law thresholds, fines, tax): official dated source plus an Astra check, with as-of and refresh dates; never from memory.
- **FAQPage markup is off.**

## 9. Open founder questions

1. WhatsApp wording: "on request" or something else? Until answered it is `withheld`.
2. Which payment providers are live per market (C8), and is a Calendly / Cal.com importer real (C5)?
3. Payable currency, availability statement and support language for GB, CA, AU, DE, FR, IT, JP.
4. Approve the official identity naming Soor LLC (P7)?
5. Approve named-competitor comparison records (C12)?
6. Order: finish the open PRs first (recommended), or rebase them onto this contract?
