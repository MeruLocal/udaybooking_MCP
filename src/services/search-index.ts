import type { Logger } from "../utils/logger.js";
import type { SiteClient } from "./site-client.js";
import type { CatalogEntry, SearchHit } from "../types.js";
import { INTERNATIONAL } from "../constants.js";

/**
 * Lazy full-text index over the public pages.
 *
 * udaybooking.com exposes no search endpoint — the only candidate would live
 * under /api/, which robots.txt disallows — so search is built locally from
 * pages this server has already fetched.
 *
 * The index is scoped to one market at a time (roughly 50-60 pages) rather than
 * the full 400-plus URL catalogue, because the same content is republished under
 * every market prefix. Warming happens once per market, with the HTTP client's
 * concurrency cap applied, and the result is cached for the process lifetime of
 * the page cache.
 */

interface IndexedPage {
  entry: CatalogEntry;
  title: string;
  description: string;
  /** Lowercased body text used for matching. */
  haystack: string;
  /** Original-case text, used to cut readable snippets. */
  original: string;
}

interface MarketIndex {
  market: string;
  pages: IndexedPage[];
  /** Paths that could not be fetched, reported so results are never silently partial. */
  failedPaths: string[];
  builtAt: number;
}

/**
 * Sections worth indexing, in priority order: these hold the prose a question
 * can be answered from. Order matters — when the page budget
 * (`config.indexMaxPages`) is smaller than the number of candidates, pages are
 * taken from the front of this list first, so documentation is never dropped in
 * favour of marketing pages.
 */
const DEFAULT_SECTIONS = [
  "docs",
  "guides",
  "help",
  "pricing",
  "product",
  "how-it-works",
  "integrations",
  "solutions",
  "security",
  "blog",
  "home",
  "resources",
] as const;

const SECTION_RANK = new Map<string, number>(DEFAULT_SECTIONS.map((s, i) => [s, i]));

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with", "is",
  "are", "was", "were", "be", "been", "do", "does", "did", "how", "what", "why", "when", "can",
  "i", "my", "me", "it", "its", "this", "that", "from", "by", "as", "about",
]);

interface IndexSlot {
  /** The index being served (resolved, or the first build in flight). */
  current: Promise<MarketIndex>;
  /** Set once `current` has resolved. */
  builtAt?: number;
  /** In-flight background rebuild, at most one per market. */
  rebuilding?: Promise<void>;
}

export class SearchIndex {
  private readonly indexes = new Map<string, IndexSlot>();

  /**
   * @param indexTtlMs Age after which a market's index is rebuilt in the
   *   background while the old one keeps serving. `0` never expires it.
   * @param now Injectable clock, for tests.
   */
  constructor(
    private readonly site: SiteClient,
    private readonly logger: Logger,
    private readonly maxPages: number,
    private readonly indexTtlMs = 0,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Searches the given market, building its index on first use.
   *
   * @param query Free-text query; terms are matched independently and scored.
   * @param market Market code, or `international` for the unprefixed site.
   * @param sections Optional section filter applied before scoring.
   * @param limit Maximum hits to return.
   */
  async search(
    query: string,
    market: string,
    sections: string[] | undefined,
    limit: number,
  ): Promise<{ hits: SearchHit[]; indexedPages: number; failedPaths: string[]; builtAt: number }> {
    const index = await this.getIndex(market);

    const terms = tokenize(query);
    if (terms.length === 0) {
      return {
        hits: [],
        indexedPages: index.pages.length,
        failedPaths: index.failedPaths,
        builtAt: index.builtAt,
      };
    }

    const wanted = sections && sections.length > 0 ? new Set(sections) : undefined;
    const scored: SearchHit[] = [];

    for (const page of index.pages) {
      if (wanted && !wanted.has(page.entry.section)) continue;

      let score = 0;
      let matchedTerms = 0;

      for (const term of terms) {
        const inTitle = countOccurrences(page.title.toLowerCase(), term);
        const inDescription = countOccurrences(page.description.toLowerCase(), term);
        const inBody = countOccurrences(page.haystack, term);
        const total = inTitle + inDescription + inBody;
        if (total === 0) continue;

        matchedTerms++;
        // Title and description are authored summaries, so weight them heavily;
        // body frequency is dampened so a long page cannot dominate on repetition.
        score += inTitle * 12 + inDescription * 6 + Math.min(inBody, 20) * 1.5;
      }

      if (matchedTerms === 0) continue;
      // Reward pages that match more of the query rather than one term many times.
      score *= matchedTerms / terms.length;

      scored.push({
        url: page.entry.url,
        path: page.entry.path,
        title: page.title || page.entry.slug,
        section: page.entry.section,
        market: page.entry.market,
        score: Math.round(score * 100) / 100,
        snippets: buildSnippets(page.original, terms),
      });
    }

    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return {
      hits: scored.slice(0, limit),
      indexedPages: index.pages.length,
      failedPaths: index.failedPaths,
      builtAt: index.builtAt,
    };
  }

  /** Number of markets currently indexed, for diagnostics. */
  get indexedMarkets(): string[] {
    return [...this.indexes.keys()];
  }

  /** When each market's served index was built (ISO), for /health. */
  get indexBuiltAt(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [market, slot] of this.indexes) {
      if (slot.builtAt !== undefined) out[market] = new Date(slot.builtAt).toISOString();
    }
    return out;
  }

  /** Resolves when no background rebuild is running (for tests). */
  async settled(): Promise<void> {
    await Promise.all([...this.indexes.values()].map((s) => s.rebuilding));
  }

  private getIndex(market: string): Promise<MarketIndex> {
    const slot = this.indexes.get(market);
    if (!slot) {
      // `current` is assigned on the next line; the callbacks close over `fresh`.
      const fresh = {} as IndexSlot;
      fresh.current = this.build(market).then(
        (index) => {
          fresh.builtAt = index.builtAt;
          return index;
        },
        (error: unknown) => {
          this.indexes.delete(market);
          throw error;
        },
      );
      this.indexes.set(market, fresh);
      return fresh.current;
    }

    const stale =
      this.indexTtlMs > 0 &&
      slot.builtAt !== undefined &&
      this.now() - slot.builtAt > this.indexTtlMs;
    if (stale && !slot.rebuilding) {
      // Stale-while-revalidate: keep serving the old index; swap it in only
      // once the new one has been built. A failed rebuild keeps the old one.
      slot.rebuilding = this.build(market)
        .then((index) => {
          slot.current = Promise.resolve(index);
          slot.builtAt = index.builtAt;
        })
        .catch((error: unknown) => {
          this.logger.warn("search index rebuild failed; keeping the previous index", {
            market,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          slot.rebuilding = undefined;
        });
    }
    return slot.current;
  }

  private async build(market: string): Promise<MarketIndex> {
    const catalog = await this.site.getCatalog();
    const candidates = catalog
      .filter((entry) => entry.market === market && SECTION_RANK.has(entry.section))
      .sort((a, b) => {
        const rank = (SECTION_RANK.get(a.section) ?? 99) - (SECTION_RANK.get(b.section) ?? 99);
        if (rank !== 0) return rank;
        // Within a section, the sitemap's own priority is the site's hint at
        // which pages matter most.
        const priority = (b.priority ?? 0) - (a.priority ?? 0);
        return priority !== 0 ? priority : a.path.localeCompare(b.path);
      });

    const targets = candidates.slice(0, this.maxPages);
    const skipped = candidates.length - targets.length;

    this.logger.info("building search index", {
      market,
      pages: targets.length,
      skipped,
      budget: this.maxPages,
    });
    const started = Date.now();

    const pages: IndexedPage[] = [];
    const failedPaths: string[] = [];

    // The HTTP client caps real concurrency; Promise.allSettled just keeps the
    // pipeline full so warming is not serialised page by page.
    const settled = await Promise.allSettled(
      targets.map(async (entry) => ({ entry, page: await this.site.getPage(entry.url) })),
    );

    for (const [i, result] of settled.entries()) {
      const entry = targets[i];
      if (!entry) continue;
      if (result.status === "rejected") {
        failedPaths.push(entry.path);
        continue;
      }
      const { page } = result.value;
      pages.push({
        entry,
        title: page.title ?? "",
        description: page.description ?? "",
        haystack: page.text.toLowerCase(),
        original: page.text,
      });
    }

    this.logger.info("search index ready", {
      market,
      indexed: pages.length,
      failed: failedPaths.length,
      ms: Date.now() - started,
    });

    return { market, pages, failedPaths, builtAt: this.now() };
  }
}

/** Splits a query into lowercased, de-duplicated, meaningful terms. */
export function tokenize(query: string): string[] {
  const raw = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(raw)].slice(0, 12);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

/** Cuts up to two short, readable excerpts around the earliest matches. */
export function buildSnippets(text: string, terms: string[], max = 2): string[] {
  const lower = text.toLowerCase();
  const snippets: string[] = [];
  const used: number[] = [];

  for (const term of terms) {
    if (snippets.length >= max) break;
    const at = lower.indexOf(term);
    if (at === -1) continue;
    // Skip a match that sits inside an excerpt already emitted.
    if (used.some((u) => Math.abs(u - at) < 220)) continue;
    used.push(at);

    const start = Math.max(0, at - 90);
    const end = Math.min(text.length, at + term.length + 150);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < text.length ? "…" : "";
    snippets.push(`${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`);
  }

  return snippets;
}

/** Exported for tests and for the tool's documented section filter. */
export const INDEXED_SECTIONS: readonly string[] = DEFAULT_SECTIONS;
export const DEFAULT_SEARCH_MARKET = INTERNATIONAL;
