import type { Config } from "../config.js";
import type { Logger } from "../utils/logger.js";
import type { HttpClient } from "./http-client.js";
import type {
  CatalogEntry,
  CatalogResult,
  FaqItem,
  PageDocument,
  PriceOffer,
} from "../types.js";
import { INTERNATIONAL, LLMS_TXT_PATH, MARKET_CODES, SITEMAP_CHILDREN } from "../constants.js";
import { TtlCache } from "../utils/cache.js";
import { UdayBookingError, notFound } from "../utils/errors.js";
import {
  extractJsonLd,
  extractMeta,
  extractReadableBody,
  extractTitle,
  flattenJsonLdNodes,
  hasType,
  htmlToMarkdown,
  htmlToText,
} from "../utils/html.js";

/**
 * Reads the public site and turns it into the typed model in `types.ts`.
 *
 * Everything here is derived from what the site actually publishes: the three
 * sitemaps, the per-page JSON-LD graph, and meta tags. No endpoint is invented
 * and no response shape is assumed.
 */
export class SiteClient {
  private readonly pageCache: TtlCache<PageDocument>;
  private readonly rawCache: TtlCache<string>;
  private catalogPromise?: Promise<CatalogResult>;

  constructor(
    private readonly http: HttpClient,
    config: Config,
    private readonly logger: Logger,
  ) {
    this.pageCache = new TtlCache<PageDocument>(config.cacheTtlMs, config.cacheMaxEntries);
    this.rawCache = new TtlCache<string>(config.cacheTtlMs, 32);
  }

  /**
   * The full page catalogue, from the three sitemaps listed in /sitemap.xml,
   * deduplicated by URL because the markets and resources sitemaps overlap on
   * some market paths.
   *
   * A **complete** load is memoised for the process. A **partial** one (the
   * origin drops connections intermittently) is returned but deliberately not
   * memoised, so the next call retries the missing sitemaps. Without this, one
   * unlucky startup would leave the catalogue permanently missing a whole
   * sitemap's worth of pages and tools would report "no pages match" for paths
   * that do exist.
   */
  async getCatalog(): Promise<CatalogEntry[]> {
    return (await this.getCatalogResult()).entries;
  }

  /** As `getCatalog`, but also reports which sitemaps failed. */
  async getCatalogResult(): Promise<CatalogResult> {
    if (this.catalogPromise) return this.catalogPromise;

    const pending = this.loadCatalog();
    this.catalogPromise = pending;

    try {
      const result = await pending;
      if (result.failures.length > 0) {
        this.catalogPromise = undefined; // retry the gaps on the next call
      }
      return result;
    } catch (error) {
      this.catalogPromise = undefined; // a transient drop must not poison the process
      throw error;
    }
  }

  private async loadCatalog(): Promise<CatalogResult> {
    const byUrl = new Map<string, CatalogEntry>();

    const results = await Promise.allSettled(
      SITEMAP_CHILDREN.map(async (child) => {
        const { body } = await this.http.fetchText(child);
        return parseUrlSet(body);
      }),
    );

    const failures: string[] = [];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        for (const entry of result.value) {
          const classified = classify(entry);
          if (classified) byUrl.set(classified.url, classified);
        }
      } else {
        failures.push(`${SITEMAP_CHILDREN[i]}: ${describeError(result.reason)}`);
      }
    });

    if (byUrl.size === 0) {
      throw new UdayBookingError(
        "UPSTREAM_UNAVAILABLE",
        `Could not load any sitemap from udaybooking.com. ${failures.join("; ")}`,
        { retryable: true, hint: "The origin may be briefly unreachable; retry shortly." },
      );
    }
    if (failures.length > 0) {
      this.logger.warn("partial sitemap load", { failures, loaded: byUrl.size });
    }

    const entries = [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
    this.logger.info("catalog loaded", { pages: entries.length, failures: failures.length });
    return { entries, failures };
  }

  /** Fetches and parses a single page, honouring the cache. */
  async getPage(pathOrUrl: string): Promise<PageDocument> {
    const url = this.http.resolveUrl(pathOrUrl);
    const cached = this.pageCache.get(url);
    if (cached) return cached;

    const { body, url: finalUrl } = await this.http.fetchText(url);
    const doc = parsePage(finalUrl, body);
    this.pageCache.set(url, doc);
    if (finalUrl !== url) this.pageCache.set(finalUrl, doc);
    return doc;
  }

  /** Fetches /llms.txt, the site's own machine-readable summary. */
  async getLlmsTxt(): Promise<string> {
    const cached = this.rawCache.get(LLMS_TXT_PATH);
    if (cached) return cached;
    const { body } = await this.http.fetchText(LLMS_TXT_PATH);
    this.rawCache.set(LLMS_TXT_PATH, body);
    return body;
  }

  /** Extracts every FAQPage question/answer pair from a page. */
  async getFaqs(pathOrUrl: string): Promise<FaqItem[]> {
    const page = await this.getPage(pathOrUrl);
    const faqs: FaqItem[] = [];
    for (const node of page.jsonLdNodes) {
      if (!hasType(node, "FAQPage")) continue;
      const entities = Array.isArray(node.mainEntity) ? node.mainEntity : [];
      for (const raw of entities) {
        if (!raw || typeof raw !== "object") continue;
        const q = raw as Record<string, unknown>;
        const question = typeof q.name === "string" ? q.name.trim() : "";
        const answerNode = q.acceptedAnswer as Record<string, unknown> | undefined;
        const answer =
          answerNode && typeof answerNode.text === "string" ? answerNode.text.trim() : "";
        if (question && answer) faqs.push({ question, answer, sourceUrl: page.url });
      }
    }
    return faqs;
  }

  /**
   * Extracts plan offers from a pricing page's SoftwareApplication.offers.
   *
   * The site publishes each plan twice, once per billing currency (USD and INR),
   * which matches its stated policy that those are the two contracted currencies.
   * Both are returned; callers filter by currency.
   */
  async getOffers(pathOrUrl: string): Promise<PriceOffer[]> {
    const page = await this.getPage(pathOrUrl);
    const offers: PriceOffer[] = [];

    for (const node of page.jsonLdNodes) {
      const rawOffers = node.offers;
      if (!Array.isArray(rawOffers)) continue;
      for (const item of rawOffers) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const plan = typeof o.name === "string" ? o.name : undefined;
        const price = typeof o.price === "number" ? o.price : Number(o.price);
        const currency = typeof o.priceCurrency === "string" ? o.priceCurrency : undefined;
        if (!plan || !currency || !Number.isFinite(price)) continue;

        const spec = o.priceSpecification as Record<string, unknown> | undefined;
        const unit = spec && typeof spec.unitText === "string" ? spec.unitText : undefined;
        const duration = spec?.billingDuration as Record<string, unknown> | undefined;
        const billingMonths =
          duration && typeof duration.value === "number" && duration.unitCode === "MON"
            ? duration.value
            : undefined;

        offers.push({
          plan,
          price,
          currency,
          ...(typeof o.description === "string" ? { description: o.description } : {}),
          ...(unit ? { unit } : {}),
          ...(billingMonths !== undefined ? { billingMonths } : {}),
        });
      }
    }

    if (offers.length === 0) {
      throw notFound(
        `No schema.org Offer data found on ${page.url}.`,
        "Only pricing pages carry machine-readable offers. Try market='in' or another market code.",
      );
    }
    return offers;
  }

  /** Cache statistics, surfaced by tools so callers can reason about freshness. */
  stats(): { cachedPages: number } {
    return { cachedPages: this.pageCache.size };
  }
}

/** Parses a urlset sitemap into raw entries. */
export function parseUrlSet(
  xml: string,
): { loc: string; changefreq?: string; priority?: number }[] {
  const entries: { loc: string; changefreq?: string; priority?: number }[] = [];
  const blockRe = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1] ?? "";
    const loc = tag(block, "loc");
    if (!loc) continue;
    const changefreq = tag(block, "changefreq");
    const priorityText = tag(block, "priority");
    const priority = priorityText === undefined ? undefined : Number(priorityText);
    entries.push({
      loc,
      ...(changefreq ? { changefreq } : {}),
      ...(priority !== undefined && Number.isFinite(priority) ? { priority } : {}),
    });
  }
  return entries;
}

function tag(block: string, name: string): string | undefined {
  const re = new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i");
  const m = re.exec(block);
  const value = m?.[1]?.trim();
  return value || undefined;
}

/** Derives market, section and slug from a sitemap URL. */
export function classify(entry: {
  loc: string;
  changefreq?: string;
  priority?: number;
}): CatalogEntry | undefined {
  let url: URL;
  try {
    url = new URL(entry.loc);
  } catch {
    return undefined;
  }

  const path = url.pathname === "" ? "/" : url.pathname.replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean);

  const first = segments[0];
  const hasMarket = first !== undefined && (MARKET_CODES as readonly string[]).includes(first);
  const market = hasMarket ? (first as string) : INTERNATIONAL;
  const rest = hasMarket ? segments.slice(1) : segments;

  const section = sectionFor(rest);
  const slug = rest.length > 0 ? (rest[rest.length - 1] as string) : "home";

  return {
    url: `${url.origin}${path === "/" ? "" : path}`,
    path,
    market,
    section,
    slug,
    ...(entry.changefreq ? { changeFrequency: entry.changefreq } : {}),
    ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
  };
}

function sectionFor(rest: string[]): string {
  if (rest.length === 0) return "home";
  const head = rest[0] as string;
  if (["about", "careers", "contact", "demo"].includes(head)) return "company";
  if (["privacy", "terms"].includes(head)) return "legal";
  return head;
}

/** Parses a fetched HTML page into the PageDocument model. */
export function parsePage(url: string, html: string): PageDocument {
  const meta = extractMeta(html);
  const nodes = flattenJsonLdNodes(extractJsonLd(html));

  const parsed = new URL(url);
  const path = parsed.pathname === "" ? "/" : parsed.pathname.replace(/\/+$/, "") || "/";
  const classified = classify({ loc: url });
  const title = extractTitle(html);

  const breadcrumbs = extractBreadcrumbs(nodes);
  const article = nodes.find((n) => hasType(n, "BlogPosting") || hasType(n, "TechArticle"));

  // Read the <main> landmark without navbar, sidebar or footer: that chrome is
  // identical on every page and would otherwise dominate short docs pages.
  const body = extractReadableBody(html);

  return {
    url,
    path,
    market: classified?.market ?? INTERNATIONAL,
    section: classified?.section ?? "home",
    ...(title ? { title } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta["og:locale"] ? { locale: meta["og:locale"] } : {}),
    markdown: htmlToMarkdown(body),
    text: htmlToText(body),
    jsonLdNodes: nodes,
    breadcrumbs,
    ...(article && typeof article.datePublished === "string"
      ? { datePublished: article.datePublished }
      : {}),
    ...(article && typeof article.dateModified === "string"
      ? { dateModified: article.dateModified }
      : {}),
    ...(article && typeof article.articleSection === "string"
      ? { articleSection: article.articleSection }
      : {}),
  };
}

function extractBreadcrumbs(nodes: Record<string, unknown>[]): string[] {
  const node = nodes.find((n) => hasType(n, "BreadcrumbList"));
  if (!node || !Array.isArray(node.itemListElement)) return [];
  return (node.itemListElement as unknown[])
    .map((raw) => {
      if (!raw || typeof raw !== "object") return undefined;
      const item = raw as Record<string, unknown>;
      const position = typeof item.position === "number" ? item.position : Number.MAX_SAFE_INTEGER;
      const name = typeof item.name === "string" ? item.name : undefined;
      return name ? { position, name } : undefined;
    })
    .filter((v): v is { position: number; name: string } => v !== undefined)
    .sort((a, b) => a.position - b.position)
    .map((v) => v.name);
}

function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
