# Plan: stop hard-coding commercial claims in tool text

- **Severity:** P1 (agents quote these verbatim; skill §3 and V3)
- **Effort:** S

## Finding

Prices themselves are read live from the pricing page's schema.org offers, which is good. But several **commercial claims around them are typed into the code**, so they will silently go wrong the day the site changes, and no test or audit will notice.

| Claim | Where |
| --- | --- |
| "bills in two currencies only: USD and INR" | `src/tools/site.ts:70` (list_markets notes), `src/tools/pricing.ts:37` (description), `src/tools/pricing.ts:76` (notes) |
| "product, plans and prices are identical in every market" | `src/tools/site.ts:31`, `:69`; `src/tools/pricing.ts:75` |
| "structured offers cover the Free and Professional plans", "Enterprise is quoted" | `src/tools/pricing.ts:43`, `:77` |
| "Annual billing ... 20% below the monthly rate" | `src/tools/pricing.ts:43` (tool description) |
| "22 on the help centre, 9 on the pricing page" FAQ counts | `src/capabilities.ts:51-52`, `:143`; `src/schemas/index.ts:117` |
| "seven country editions" | `src/tools/site.ts:31`, `src/tool-catalog.ts:39` (derived from `MARKETS`, so lower risk) |

- The tool **description** is the worst place: clients cache tool lists, and agents treat descriptions as authoritative. "20% below" in a description is a price claim with no source at call time.
- None of this was checked against the founder's canonical pricing source in this audit. The sandbox cannot reach udaybooking.com, so I cannot say whether any claim is wrong today, only that nothing keeps them right.

Measured: `audit-live-mcp.mjs` (2026-10-14, local scratch build) cannot check truth (it says so: "are the numbers the tools return TRUE against the canonical source?"). This finding comes from reading the code.

## Proposed fix

No price, plan name, discount or currency is changed by this plan.

1. **Tool descriptions** (`pricing.ts`, `site.ts`, `faqs` schema text): remove numbers and plan names. Describe what the tool returns, not what the answer is today. For example: "Returns the plans and prices the pricing page publishes as schema.org offers, in each currency it lists."
2. **Notes in results:** derive them from the fetched data where possible:
   - currencies: `[...new Set(offers.map(o => o.currency))]`
   - plans with a machine-readable price: from `offers`
   - FAQ counts: from the parsed FAQPage on that call
3. **Claims that cannot be derived** (market parity, "Enterprise is quoted", annual discount): either quote them from the page text with the source URL, or drop them. Do not keep them as constants.
4. **`capabilities.ts`:** replace "22 / 9" with "the FAQ pairs published on the help centre and pricing page" (the identity plan #4 also edits this file; whichever merges second rebases).

## Tests to add

- A test that renders every tool description and the capability report and fails on `/\b\d+%/`, `/\bUSD\b|\bINR\b/` and `/\b(Free|Professional|Enterprise)\b/` (plan names) in **descriptions** only.
- `pricing` with a fixture that has a third currency: the note lists three currencies.
- `faqs`/capabilities: counts come from the fixture, not a constant.

## Risks, rollout, decisions

- Overlaps the text that plan #4 (official identity) edits in `capabilities.ts`. Merge #4 first.
- **Founder:** name the canonical source for pricing claims (the live pricing page JSON-LD, or another file). Until then, the plan removes claims rather than restating them.
- **Founder:** is "same product, plans and prices in every market" a claim you want agents to repeat? If yes, it should live on the site (and be quoted from there), not in this server.
