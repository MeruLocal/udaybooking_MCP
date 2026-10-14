/**
 * Fixtures copied from real udaybooking.com responses, trimmed for size.
 *
 * These are abridged recordings, not invented shapes: the JSON-LD graphs, meta
 * tags and landmark structure match what the live site serves, so the parsers
 * are tested against reality rather than against a convenient fiction.
 */

export const PRICING_HTML = `<!DOCTYPE html><html lang="en-IN"><head>
<title>udaybooking pricing in India — udaybooking</title>
<meta name="description" content="udaybooking pricing for India: a free plan for one user, Professional priced per user in rupees, Enterprise quoted."/>
<meta property="og:locale" content="en_IN"/>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
{"@type":"WebPage","@id":"https://udaybooking.com/in/pricing#webpage","name":"udaybooking pricing in India"},
{"@type":"BreadcrumbList","itemListElement":[
  {"@type":"ListItem","position":2,"name":"Pricing","item":"https://udaybooking.com/in/pricing"},
  {"@type":"ListItem","position":1,"name":"Home","item":"https://udaybooking.com/in"}]},
{"@type":"FAQPage","mainEntity":[
  {"@type":"Question","name":"Which plan should I start with?","acceptedAnswer":{"@type":"Answer","text":"Free, if you are one person who needs a booking link."}},
  {"@type":"Question","name":"Is there a platform fee on top of the per-user price?","acceptedAnswer":{"@type":"Answer","text":"No. There is no platform fee on any plan."}}]},
{"@type":"SoftwareApplication","name":"udaybooking","offers":[
  {"@type":"Offer","name":"Free","price":0,"priceCurrency":"USD","description":"Free — free for 1 user, no credit card, no platform fee."},
  {"@type":"Offer","name":"Free","price":0,"priceCurrency":"INR","description":"Free — free for 1 user, no credit card, no platform fee."},
  {"@type":"Offer","name":"Professional","price":10,"priceCurrency":"USD","description":"Professional — per user per month, 1–100 users, no platform fee.","priceSpecification":{"@type":"UnitPriceSpecification","price":10,"priceCurrency":"USD","unitText":"per user per month","billingDuration":{"@type":"QuantitativeValue","value":1,"unitCode":"MON"}}},
  {"@type":"Offer","name":"Professional","price":899,"priceCurrency":"INR","description":"Professional — per user per month, 1–100 users, no platform fee.","priceSpecification":{"@type":"UnitPriceSpecification","price":899,"priceCurrency":"INR","unitText":"per user per month","billingDuration":{"@type":"QuantitativeValue","value":1,"unitCode":"MON"}}}]}]}</script>
</head><body>
<header data-section="navbar"><nav aria-label="Main"><a href="/in">Home</a> Log in Sign up</nav></header>
<main id="main">
<nav aria-label="Breadcrumb"><a href="/in">Home</a> Pricing</nav>
<h1>Pricing</h1>
<p>Start free, with the limits written down</p>
<h2>Professional</h2>
<p>&#8377;899 per user per month. Minimum users 1. Maximum users 100.</p>
<ul><li>Team scheduling &mdash; round robin, collective and group</li><li>Routing forms</li></ul>
</main>
<footer><nav aria-label="Footer"><a href="/in/terms">Terms</a></nav>© 2026 udaybooking</footer>
</body></html>`;

export const DOC_HTML = `<!DOCTYPE html><html lang="en-IN"><head>
<title>Availability · Docs — India — udaybooking</title>
<meta name="description" content="In India: Working hours, booking window, date overrides and timezones."/>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
{"@type":"BreadcrumbList","itemListElement":[
  {"@type":"ListItem","position":1,"name":"Home","item":"https://udaybooking.com/in"},
  {"@type":"ListItem","position":2,"name":"Docs","item":"https://udaybooking.com/in/docs"},
  {"@type":"ListItem","position":3,"name":"Availability","item":"https://udaybooking.com/in/docs/availability"}]},
{"@type":"TechArticle","headline":"Availability","articleSection":"Scheduling","datePublished":"2026-05-01","dateModified":"2026-09-20"}]}</script>
</head><body>
<header data-section="navbar"><nav aria-label="Main">Features Resources Pricing</nav></header>
<main id="main">
<aside><details><summary>Browse documentation</summary><div>Basics
<nav aria-label="Documentation"><a href="/in/docs/getting-started">Getting started</a><a href="/in/docs/availability">Availability</a></nav></div></details></aside>
<h1>Availability</h1>
<p>Working hours decide when a booking type can be booked.</p>
<h2>Booking window</h2>
<p>A booking window limits how far ahead guests can book.</p>
<nav aria-label="Previous and next"><a href="/in/docs/booking-types">Booking types</a></nav>
</main>
<footer><nav aria-label="Footer">Privacy Terms</nav></footer>
</body></html>`;

/**
 * A page whose body comfortably exceeds the 500-character minimum for
 * `max_chars`, so the truncation path can be exercised through the tool layer.
 */
export const LONG_DOC_HTML = `<!DOCTYPE html><html><head>
<title>Timezones · Docs — udaybooking</title>
<meta name="description" content="How times are displayed to hosts and guests."/>
</head><body><main id="main"><h1>Timezones</h1>
${Array.from(
  { length: 14 },
  (_, i) =>
    `<p>Paragraph ${i + 1}: every guest sees available times in their own timezone, and the ` +
    `host sees the same meeting in theirs, because udaybooking converts between them rather ` +
    `than asking either side to do the arithmetic.</p>`,
).join("\n")}
</main></body></html>`;

/** A page with no FAQ and no offers, for the empty-result paths. */
export const PLAIN_HTML = `<!DOCTYPE html><html><head><title>Security — udaybooking</title></head>
<body><main id="main"><h1>Security</h1><p>How bookings and calendar tokens are handled.</p></main></body></html>`;

export const SITEMAP_PAGES = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://udaybooking.com</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
  <url><loc>https://udaybooking.com/pricing</loc><changefreq>monthly</changefreq><priority>0.9</priority></url>
  <url><loc>https://udaybooking.com/docs/availability</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://udaybooking.com/guides/round-robin-sales</loc><priority>0.6</priority></url>
  <url><loc>https://udaybooking.com/terms</loc></url>
</urlset>`;

export const SITEMAP_MARKETS = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://udaybooking.com/in</loc><priority>1.0</priority></url>
  <url><loc>https://udaybooking.com/in/pricing</loc><priority>0.9</priority></url>
  <url><loc>https://udaybooking.com/us/pricing</loc><priority>0.9</priority></url>
</urlset>`;

export const SITEMAP_RESOURCES = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://udaybooking.com/in/docs/availability</loc><priority>0.7</priority></url>
  <url><loc>https://udaybooking.com/in/help</loc><priority>0.8</priority></url>
</urlset>`;

export const HELP_HTML = `<!DOCTYPE html><html><head><title>Help centre — udaybooking</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
{"@type":"FAQPage","mainEntity":[
 {"@type":"Question","name":"How does a guest reschedule?","acceptedAnswer":{"@type":"Answer","text":"From the link in their confirmation or reminder email."}},
 {"@type":"Question","name":"Can I get booking data into my own system?","acceptedAnswer":{"@type":"Answer","text":"Yes. Configure an outbound webhook on booking events, or use the agent endpoints to book programmatically."}},
 {"@type":"Question","name":"How do I block a day off?","acceptedAnswer":{"@type":"Answer","text":"Add a date override for that day."}}]}]}</script>
</head><body><main id="main"><h1>Help centre</h1></main></body></html>`;

export const LLMS_TXT = `# udaybooking

> udaybooking is a scheduling and appointment tool.

## Pricing
- Free: free for 1 user.
- Professional: $10 per user per month.
`;

/** Maps a path to fixture content, mirroring the live site's routing. */
export const ROUTES: Record<string, string> = {
  "/sitemaps/pages.xml": SITEMAP_PAGES,
  "/sitemaps/markets.xml": SITEMAP_MARKETS,
  "/sitemaps/resources.xml": SITEMAP_RESOURCES,
  "/llms.txt": LLMS_TXT,
  "/pricing": PRICING_HTML,
  "/in/pricing": PRICING_HTML,
  "/us/pricing": PRICING_HTML,
  "/docs/availability": DOC_HTML,
  "/in/docs/availability": DOC_HTML,
  "/docs/timezones": LONG_DOC_HTML,
  "/in/docs/timezones": LONG_DOC_HTML,
  "/help": HELP_HTML,
  "/in/help": HELP_HTML,
  "/security": PLAIN_HTML,
  "/in": PLAIN_HTML,
  "": PLAIN_HTML,
  "/guides/round-robin-sales": DOC_HTML,
  "/terms": PLAIN_HTML,
};
