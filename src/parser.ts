/**
 * Deterministic HTML parser: FeedConfig + HTML → Article[]
 */

import * as cheerio from "cheerio";
import { parse as dateParse } from "date-fns";
import type { Article, FeedConfig } from "./types.js";

/**
 * Resolve a possibly relative URL against a base.
 */
function resolveUrl(raw: string, prefix?: string, baseUrl?: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // If prefix is specified, prepend it to relative URLs
  if (prefix && !trimmed.startsWith("http")) {
    return prefix.replace(/\/$/, "") + "/" + trimmed.replace(/^\//, "");
  }

  // Try to resolve as absolute
  if (trimmed.startsWith("http")) return trimmed;

  // Use base URL if available
  if (baseUrl) {
    try {
      return new URL(trimmed, baseUrl).href;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

/**
 * Extract text from a selector, stripping HTML tags.
 */
function extractText($el: cheerio.Cheerio<any>, selector: string): string {
  const target = selector === "." ? $el : $el.find(selector);
  return target.first().text().trim();
}

/**
 * Extract link value based on source descriptor.
 * source: "attr:href" → get href attribute
 * source: "text" → get text content
 */
function extractLink(
  $el: cheerio.Cheerio<any>,
  selector: string,
  source: string
): string {
  // The selector might point to an <a> tag or a container
  const target = selector === "." ? $el : $el.find(selector);
  const first = target.first();

  if (source.startsWith("attr:")) {
    const attr = source.slice(5);
    // If the target itself has the attr, use it; otherwise look for <a>
    const val = first.attr(attr);
    if (val) return val;
    const anchor = first.find("a").first();
    return anchor.attr(attr) || "";
  }

  if (source === "text") {
    return first.text().trim();
  }

  return "";
}

/**
 * Try to parse a date string with optional format.
 */
function parseDate(raw: string, format?: string): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();

  // Try explicit format first
  if (format) {
    try {
      const d = dateParse(trimmed, format, new Date());
      if (!isNaN(d.getTime())) return d;
    } catch {
      // fall through
    }
  }

  // Try native Date parsing
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  return undefined;
}

/**
 * Parse HTML using a FeedConfig and return extracted articles.
 */
export function parseArticles(html: string, config: FeedConfig): Article[] {
  const $ = cheerio.load(html);
  const articles: Article[] = [];
  const { selectors } = config;

  $(selectors.articleList).each((_, el) => {
    const $el = $(el);

    // Extract title
    const title = extractText($el, selectors.title);
    if (!title) return; // skip entries without titles

    // Extract link — try from title selector first, then from articleList itself
    let linkRaw = "";
    if (selectors.link.source.startsWith("attr:")) {
      // Try getting href from the title's <a> tag
      const titleEl = selectors.title === "." ? $el : $el.find(selectors.title);
      const anchor = titleEl.find("a").first();
      linkRaw = anchor.attr(selectors.link.source.slice(5)) || "";

      // If not found, try the title element itself
      if (!linkRaw) {
        linkRaw = titleEl.first().attr(selectors.link.source.slice(5)) || "";
      }

      // If still not found, try the articleList element's <a>
      if (!linkRaw) {
        const parentAnchor = $el.find("a").first();
        linkRaw = parentAnchor.attr(selectors.link.source.slice(5)) || "";
      }
    } else {
      linkRaw = extractLink($el, selectors.title, selectors.link.source);
    }

    const link = resolveUrl(linkRaw, selectors.link.prefix, config.url);
    if (!link) return; // skip entries without links

    // Extract date (optional)
    let date: Date | undefined;
    if (selectors.date) {
      const dateRaw = extractText($el, selectors.date);
      date = parseDate(dateRaw, config.dateFormat);
    }

    // Extract description (optional)
    let description: string | undefined;
    if (selectors.description) {
      description = extractText($el, selectors.description);
    }

    articles.push({ title, link, date, description });
  });

  // Deduplicate by link (some sites render HTML twice for SSR/hydration)
  const seen = new Set<string>();
  return articles.filter(a => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });
}
