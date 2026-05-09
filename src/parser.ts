/**
 * Deterministic HTML parser: FeedConfig + HTML → Article[]
 */

import * as cheerio from "cheerio";
import { parse as dateParse } from "date-fns";
import { marked } from "marked";
import RSSParser from "rss-parser";
import type { Article, FeedConfig } from "./types.js";

const rssParser = new RSSParser({
  customFields: {
    item: ["content:encoded", "media:content"],
  },
});

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
 * Parse a Keep a Changelog style markdown document into articles.
 * Each ## version heading becomes one RSS article.
 *
 * Supports formats:
 *   ## 2026.3.13
 *   ## [1.0.0] - 2024-01-15
 *   ## v2.0.0 (2024-01-15)
 *   ## Unreleased
 */
function parseChangelogArticles(text: string, config: FeedConfig): Article[] {
  const ext = config.changelogExtraction ?? {};
  const articles: Article[] = [];

  // Split by ## headings (h2), keeping the heading text
  const versionRegex = /^## (.+)$/gm;
  const matches: { heading: string; start: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = versionRegex.exec(text)) !== null) {
    matches.push({ heading: match[1].trim(), start: match.index });
  }

  if (matches.length === 0) return articles;

  for (let i = 0; i < matches.length; i++) {
    const { heading, start } = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const body = text.slice(start, end).trim();

    // Skip the "Unreleased" section — it's not a version
    if (/^unreleased$/i.test(heading)) continue;

    // Extract version string: handle [1.0.0], v1.0.0, 2026.3.13, etc.
    const versionMatch = heading.match(
      /\[?v?(\d[\w.\-]+)\]?/i
    );
    const version = versionMatch?.[1] ?? heading;

    // Try to extract date from heading
    let date: Date | undefined;

    // Format: ## [1.0.0] - 2024-01-15 or ## 1.0.0 (2024-01-15)
    const dateInHeading = heading.match(
      /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/
    );
    if (dateInHeading) {
      const d = new Date(dateInHeading[1].replace(/\//g, "-"));
      if (!isNaN(d.getTime())) date = d;
    }

    // Format: ## 2026.3.13 (version IS the date)
    if (!date) {
      const dotDate = version.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
      if (dotDate) {
        const d = new Date(
          `${dotDate[1]}-${dotDate[2].padStart(2, "0")}-${dotDate[3].padStart(2, "0")}`
        );
        if (!isNaN(d.getTime())) date = d;
      }
    }

    // Extract section content (### Changes, ### Fixes, ### Breaking, etc.)
    const sectionRegex = /^### (.+)$/gm;
    const sections: { name: string; items: string[] }[] = [];
    let secMatch: RegExpExecArray | null;
    const secMatches: { name: string; start: number }[] = [];

    // Reset lastIndex for body-scoped search
    const bodyContent = body.replace(/^## .+$/m, "").trim();
    const secRe = /^### (.+)$/gm;
    while ((secMatch = secRe.exec(bodyContent)) !== null) {
      secMatches.push({ name: secMatch[1].trim(), start: secMatch.index });
    }

    for (let j = 0; j < secMatches.length; j++) {
      const secEnd =
        j + 1 < secMatches.length ? secMatches[j + 1].start : bodyContent.length;
      const secBody = bodyContent.slice(secMatches[j].start, secEnd);

      // Filter by configured sections if specified
      if (
        ext.sections &&
        ext.sections.length > 0 &&
        !ext.sections.some(
          (s) => s.toLowerCase() === secMatches[j].name.toLowerCase()
        )
      ) {
        continue;
      }

      // Extract bullet items
      const items = secBody
        .split("\n")
        .filter((line) => /^\s*-\s/.test(line))
        .map((line) => line.replace(/^\s*-\s+/, "").trim());

      if (items.length > 0) {
        sections.push({ name: secMatches[j].name, items });
      }
    }

    // Build description from sections
    const descParts: string[] = [];
    for (const sec of sections) {
      descParts.push(`${sec.name}: ${sec.items.length} items`);
    }
    const description =
      descParts.length > 0
        ? descParts.join(" | ")
        : bodyContent.slice(0, 200).trim();

    // Build link
    let link = config.url;
    if (ext.linkTemplate) {
      link = ext.linkTemplate.replace("{version}", version);
    }

    const title = `${config.feed.title} ${version}`;

    articles.push({ title, link, date, description });
  }

  return articles;
}

/**
 * For changelog mode, we might be fetching raw markdown from GitHub.
 * Extract markdown text from HTML if needed (GitHub renders .md files as HTML).
 */
function extractMarkdownFromHtml(html: string): string {
  // If it looks like raw markdown already (starts with # or has ## headings), use as-is
  if (/^#\s/m.test(html) || /^## /m.test(html)) {
    return html;
  }

  // Try to extract from GitHub's rendered HTML
  const $ = cheerio.load(html);

  // GitHub wraps markdown content in <article>
  const article = $("article").first();
  if (article.length > 0) {
    // Get the text content, preserving structure
    return article.text();
  }

  // Fallback: just return the raw text
  return $.text();
}

/**
 * Parse GitHub Releases API JSON response into articles.
 * The `html` parameter here is actually the raw JSON from the API.
 */
function parseGithubReleasesArticles(json: string, config: FeedConfig): Article[] {
  const ext = config.githubReleasesExtraction!;
  const articles: Article[] = [];

  let releases: any[];
  try {
    releases = JSON.parse(json);
  } catch {
    console.error("  ❌ Failed to parse GitHub Releases API response");
    return [];
  }

  if (!Array.isArray(releases)) return [];

  for (const release of releases) {
    // Skip prereleases unless configured
    if (release.prerelease && !ext.includePrerelease) continue;
    // Skip drafts
    if (release.draft) continue;

    const title = release.name || release.tag_name || "Untitled";
    const link = release.html_url || `https://github.com/${ext.owner}/${ext.repo}/releases/tag/${release.tag_name}`;

    let date: Date | undefined;
    if (release.published_at) {
      const d = new Date(release.published_at);
      if (!isNaN(d.getTime())) date = d;
    } else if (release.created_at) {
      const d = new Date(release.created_at);
      if (!isNaN(d.getTime())) date = d;
    }

    // Both description and content get full HTML — most readers only use description
    let html = "";
    if (release.body) {
      try {
        html = marked.parse(release.body, { async: false }) as string;
      } catch {
        html = `<p>${release.body}</p>`;
      }
    }

    if (!html) html = `<p>Release ${release.tag_name}</p>`;

    articles.push({ title, link, date, description: html, content: html });
  }

  return articles;
}

/**
 * Parse an upstream RSS/Atom feed (mirror mode) into Article[].
 * The XML has already been fetched from `config.rssExtraction.feedUrl`.
 */
async function parseRssMirrorArticles(xml: string): Promise<Article[]> {
  const feed = await rssParser.parseString(xml);
  const articles: Article[] = [];

  for (const item of feed.items) {
    const title = item.title?.trim();
    const link = item.link?.trim();
    if (!title || !link) continue;

    let date: Date | undefined;
    const isoDate = item.isoDate || item.pubDate;
    if (isoDate) {
      const d = new Date(isoDate);
      if (!isNaN(d.getTime())) date = d;
    }

    const contentEncoded = (item as unknown as Record<string, unknown>)["content:encoded"];
    const fullHtml =
      (typeof contentEncoded === "string" && contentEncoded) ||
      item.content ||
      undefined;
    const description =
      item.contentSnippet?.trim() ||
      (typeof item.summary === "string" ? item.summary.trim() : undefined) ||
      fullHtml ||
      undefined;

    articles.push({
      title,
      link,
      date,
      description,
      content: fullHtml,
    });
  }

  return articles;
}

/**
 * Parse HTML using a FeedConfig and return extracted articles.
 */
export async function parseArticles(html: string, config: FeedConfig): Promise<Article[]> {
  if (config.parserMode === "github-releases" && config.githubReleasesExtraction) {
    return parseGithubReleasesArticles(html, config);
  }
  if (config.parserMode === "rss" && config.rssExtraction) {
    return parseRssMirrorArticles(html);
  }
  if (config.parserMode === "changelog") {
    const markdown = extractMarkdownFromHtml(html);
    return parseChangelogArticles(markdown, config);
  }
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
