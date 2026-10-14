/** Shared domain types for the public udaybooking.com content model. */

/** A URL from the sitemaps, classified by market and section. */
export interface CatalogEntry {
  /** Absolute URL as published in the sitemap. */
  url: string;
  /** Site-relative path, always with a leading slash (`/` for the root). */
  path: string;
  /** Two-letter market code, or `"international"` for the unprefixed site. */
  market: string;
  /** Top-level section such as `docs`, `guides`, `pricing`. */
  section: string;
  /** Final path segment, useful as a stable slug. */
  slug: string;
  /** `changefreq` from the sitemap, when present. */
  changeFrequency?: string;
  /** `priority` from the sitemap, when present. */
  priority?: number;
}

/** A fetched and parsed page. */
export interface PageDocument {
  url: string;
  path: string;
  market: string;
  section: string;
  /** `<title>` text. */
  title?: string;
  /** `<meta name="description">`. */
  description?: string;
  /** `og:locale`, e.g. `en_IN`. */
  locale?: string;
  /** Readable body as Markdown. */
  markdown: string;
  /** Readable body as plain text (used for the search index). */
  text: string;
  /** Raw JSON-LD blocks, flattened to schema.org nodes. */
  jsonLdNodes: Record<string, unknown>[];
  /** Breadcrumb trail from `BreadcrumbList`, outermost first. */
  breadcrumbs: string[];
  /** Publication dates from `BlogPosting` / `TechArticle`, when present. */
  datePublished?: string;
  dateModified?: string;
  /** `articleSection` from the article node, when present. */
  articleSection?: string;
}

/** A question and answer pair from a `FAQPage` node. */
export interface FaqItem {
  question: string;
  answer: string;
  sourceUrl: string;
}

/** A plan offer, from `SoftwareApplication.offers` on a pricing page. */
export interface PriceOffer {
  plan: string;
  price: number;
  currency: string;
  description?: string;
  /** e.g. `per user per month`, from `priceSpecification.unitText`. */
  unit?: string;
  /** Billing period in months, from `priceSpecification.billingDuration`. */
  billingMonths?: number;
}

/** One scored search hit. */
export interface SearchHit {
  url: string;
  path: string;
  title: string;
  section: string;
  market: string;
  score: number;
  /** Short excerpts around the matched terms. */
  snippets: string[];
}

/** Catalogue load result, including which sitemaps could not be read. */
export interface CatalogResult {
  entries: CatalogEntry[];
  /** Human-readable descriptions of sitemaps that failed, empty when complete. */
  failures: string[];
}
