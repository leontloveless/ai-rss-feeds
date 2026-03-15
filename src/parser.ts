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
 * Get a nested value from an object using a dot-separated path.
 * e.g., getPath({a: {b: "c"}}, "a.b") => "c"
 */
function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, key) => o?.[key], obj);
}

/**
 * Parse HTML using JSON extraction from <script> tags.
 */
function parseJsonArticles(html: string, config: FeedConfig): Article[] {
  const $ = cheerio.load(html);
  const ext = config.jsonExtraction!;
  const articles: Article[] = [];

  // Find the script element containing JSON data
  const scriptEl = $(ext.scriptSelector);
  if (scriptEl.length === 0) {
    // Try finding JSON in any script tag
    $("script").each((_, el) => {
      const text = $(el).html() || "";
      if (text.includes(ext.dataPath.split(".")[0])) {
        try {
          // Try parsing the entire script content as JSON
          const data = JSON.parse(text);
          const items = getPath(data, ext.dataPath);
          if (Array.isArray(items)) {
            processJsonItems(items, ext, articles);
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    });
  } else {
    const raw = scriptEl.html() || "";
    try {
      const data = JSON.parse(raw);
      const items = getPath(data, ext.dataPath);
      if (Array.isArray(items)) {
        processJsonItems(items, ext, articles);
      }
    } catch {
      // Try extracting JSON from script text that might have assignments
    }
  }

  // If no articles from script tags, try extracting from inline JSON in page source
  if (articles.length === 0) {
    // Look for JSON arrays in the raw HTML (common in Next.js/Sanity sites)
    const jsonMatches = html.match(/\[(?:\{[^[\]]*"title"[^[\]]*\}[,\s]*)+\]/g);
    if (jsonMatches) {
      for (const match of jsonMatches) {
        try {
          const items = JSON.parse(match);
          if (Array.isArray(items) && items.length > 0 && items[0].title) {
            processJsonItems(items, ext, articles);
            if (articles.length > 0) break;
          }
        } catch {
          // Not valid JSON
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return articles.filter((a) => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });
}

function processJsonItems(
  items: any[],
  ext: NonNullable<FeedConfig["jsonExtraction"]>,
  articles: Article[]
): void {
  for (const item of items) {
    const title = getPath(item, ext.fields.title);
    if (!title || typeof title !== "string") continue;

    let link = "";
    const linkValue = getPath(item, ext.fields.link);
    if (ext.linkTemplate && linkValue) {
      // Replace {field.path} placeholders in template
      link = ext.linkTemplate.replace(/\{([^}]+)\}/g, (_, path) => {
        return String(getPath(item, path) ?? "");
      });
    } else if (linkValue) {
      link = String(linkValue);
    }
    if (!link) continue;

    let date: Date | undefined;
    if (ext.fields.date) {
      const dateRaw = getPath(item, ext.fields.date);
      if (dateRaw) {
        const d = new Date(String(dateRaw));
        if (!isNaN(d.getTime())) date = d;
      }
    }

    let description: string | undefined;
    if (ext.fields.description) {
      const desc = getPath(item, ext.fields.description);
      if (desc && typeof desc === "string") description = desc;
    }

    articles.push({ title: title.trim(), link, date, description });
  }
}

/**
 * Parse HTML using a FeedConfig and return extracted articles.
 */
export function parseArticles(html: string, config: FeedConfig): Article[] {
  if (config.parserMode === "json" && config.jsonExtraction) {
    return parseJsonArticles(html, config);
  }
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
