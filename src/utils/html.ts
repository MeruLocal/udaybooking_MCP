/**
 * HTML handling for udaybooking.com.
 *
 * The site is a prerendered Next.js app: every page this server reads is
 * complete, server-rendered HTML (responses carry `x-nextjs-prerender: 1`).
 * That is why there is no browser dependency here — see README "Why no
 * Playwright". Parsing is done with scoped regular expressions rather than a
 * DOM library because the only things extracted are `<script type="application
 * /ld+json">` payloads, `<meta>` tags and block-level text.
 */

const VOID_OR_INLINE_SKIP = /<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

/** Tags after which a line break is meaningful when flattening to text. */
const BLOCK_TAG =
  /<\/?(p|div|section|article|header|footer|nav|main|aside|h[1-6]|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|br|hr|blockquote|pre|figure|figcaption|form|label|button|details|summary)\b[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  times: "×",
  middot: "·",
  deg: "°",
  eacute: "é",
  copy: "©",
  reg: "®",
  trade: "™",
  shy: "",
};

/** Decodes the named and numeric HTML entities that appear on this site. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      safeCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name: string) => {
      const hit = ENTITIES[name.toLowerCase()];
      return hit === undefined ? match : hit;
    });
}

function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

/**
 * Flattens an HTML document to readable plain text, preserving paragraph breaks
 * and dropping scripts, styles and inline SVG.
 */
export function htmlToText(html: string): string {
  const withoutNoise = html.replace(COMMENT, " ").replace(VOID_OR_INLINE_SKIP, " ");
  const withBreaks = withoutNoise.replace(BLOCK_TAG, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Converts a page to lightly structured Markdown: headings keep their level and
 * list items keep their bullet, which makes documentation pages far easier for a
 * model to quote accurately than a flat wall of text.
 */
export function htmlToMarkdown(html: string): string {
  let out = html.replace(COMMENT, " ").replace(VOID_OR_INLINE_SKIP, " ");

  out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl: string, inner: string) => {
    const text = inlineText(inner);
    return text ? `\n\n${"#".repeat(Number(lvl))} ${text}\n\n` : "\n";
  });

  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => {
    const text = inlineText(inner);
    return text ? `\n- ${text}` : "";
  });

  out = out.replace(/<(p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag: string, inner: string) => {
    const text = inlineText(inner);
    if (!text) return "\n";
    return tag.toLowerCase() === "blockquote" ? `\n\n> ${text}\n\n` : `\n\n${text}\n\n`;
  });

  out = out.replace(/<br\b[^>]*>/gi, "\n");
  out = out.replace(/<hr\b[^>]*>/gi, "\n\n---\n\n");

  return htmlToText(out).replace(/\n{3,}/g, "\n\n");
}

/** Collapses a fragment of inline HTML to a single line of text. */
function inlineText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Removes balanced regions for the given tag names, nesting included.
 *
 * Used to drop site chrome — the fixed navbar, the documentation sidebar, the
 * breadcrumb and prev/next navs, and the footer — which otherwise accounts for
 * most of a short documentation page's text and pollutes the search index.
 */
export function stripElements(html: string, tagNames: string[]): string {
  let out = html;
  for (const tag of tagNames) {
    out = stripOne(out, tag);
  }
  return out;
}

function stripOne(html: string, tag: string): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  let result = "";
  let cursor = 0;

  for (;;) {
    open.lastIndex = cursor;
    const start = open.exec(html);
    if (!start) break;

    // Walk forward counting opens and closes so a nested element of the same
    // name cannot terminate the outer one early.
    let depth = 1;
    let scan = start.index + start[0].length;
    while (depth > 0) {
      open.lastIndex = scan;
      close.lastIndex = scan;
      const nextOpen = open.exec(html);
      const nextClose = close.exec(html);
      if (!nextClose) {
        // Unbalanced markup: keep the remainder rather than discarding the page.
        return result + html.slice(cursor);
      }
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        scan = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        scan = nextClose.index + nextClose[0].length;
      }
    }

    result += html.slice(cursor, start.index);
    cursor = scan;
  }

  return result + html.slice(cursor);
}

/**
 * Narrows a page to its `<main>` landmark when one exists.
 *
 * udaybooking.com renders every page inside `<main id="main">`, with the navbar
 * in `<header>` and site links in `<footer>` outside it, so this reliably
 * isolates the content a reader actually wants.
 */
export function extractMain(html: string): string {
  const open = /<main\b[^>]*>/i.exec(html);
  if (!open) return html;
  const start = open.index + open[0].length;
  const closeAt = html.toLowerCase().indexOf("</main>", start);
  if (closeAt === -1) return html.slice(start);
  return html.slice(start, closeAt);
}

/**
 * Elements removed from a page body before it becomes text.
 *
 * `aside` matters as much as `nav`: the documentation sidebar is an
 * `<aside><details><summary>Browse documentation</summary>…<nav>` structure, so
 * stripping `nav` alone would leave the disclosure heading and section labels
 * behind, polluting every documentation page's text and the search index.
 */
const CHROME_ELEMENTS = ["nav", "header", "footer", "aside", "form"] as const;

/**
 * Produces the readable body of a page: the `<main>` landmark with navigational
 * chrome removed. Falls back to the whole document when the landmark is absent.
 */
export function extractReadableBody(html: string): string {
  return stripElements(extractMain(html), [...CHROME_ELEMENTS]);
}

/** Returns the `<title>` text, or undefined when absent. */
export function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = m?.[1] ? inlineText(m[1]) : "";
  return text || undefined;
}

/**
 * Collects `<meta>` values keyed by `name` or `property`, which is where the
 * site publishes descriptions, canonical URLs and locale.
 */
export function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const tagRe = /<meta\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    const key =
      attrValue(attrs, "name") ?? attrValue(attrs, "property") ?? attrValue(attrs, "itemprop");
    const content = attrValue(attrs, "content");
    if (key && content !== undefined) meta[key.toLowerCase()] = decodeEntities(content);
  }
  return meta;
}

function attrValue(attrs: string, name: string): string | undefined {
  // Matches name="v", name='v' or bare name=v, anchored on a word boundary so
  // `content` cannot be matched by a request for `intent`.
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrs);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? m[4];
}

/**
 * Parses every `application/ld+json` block on the page.
 *
 * udaybooking.com emits two blocks per page: a page-level `@graph`
 * (WebPage / BreadcrumbList / FAQPage / TechArticle / BlogPosting, and
 * SoftwareApplication with `offers` on pricing pages) and a site-level `@graph`
 * (Organization / WebSite / SoftwareApplication). Malformed blocks are skipped
 * rather than failing the page.
 */
export function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      /* a single broken block must not cost us the rest of the page */
    }
  }
  return blocks;
}

/** Flattens JSON-LD documents and their `@graph` arrays into schema.org nodes. */
export function flattenJsonLdNodes(blocks: unknown[]): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) {
      (obj["@graph"] as unknown[]).forEach(visit);
    }
    if (obj["@type"] !== undefined) nodes.push(obj);
  };
  blocks.forEach(visit);
  return nodes;
}

/** True when a JSON-LD node carries the given `@type` (which may be an array). */
export function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t === type;
  if (Array.isArray(t)) return t.includes(type);
  return false;
}
