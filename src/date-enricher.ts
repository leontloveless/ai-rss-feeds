/**
 * Enrich articles with dates by fetching their detail pages.
 * Only runs when articles lack dates from the list page.
 * Checks <meta property="article:published_time"> and JSON-LD datePublished.
 */

import type { Article } from "./types.js";
import { fetchHTML } from "./fetcher.js";

const MAX_ARTICLES = 20; // Only enrich top N articles
const CONCURRENCY = 5; // Parallel fetches

/**
 * Extract published date from an article's detail page HTML.
 */
function extractDateFromDetailPage(html: string): Date | undefined {
  // 1. <meta property="article:published_time" content="...">
  const metaMatch = html.match(
    /property="article:published_time"\s+content="([^"]+)"/
  );
  if (metaMatch) {
    const d = new Date(metaMatch[1]);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. JSON-LD datePublished
  const jsonLdMatch = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (jsonLdMatch) {
    const d = new Date(jsonLdMatch[1]);
    if (!isNaN(d.getTime())) return d;
  }

  // 3. <time datetime="...">
  const timeMatch = html.match(/<time[^>]+datetime="([^"]+)"/);
  if (timeMatch) {
    const d = new Date(timeMatch[1]);
    if (!isNaN(d.getTime())) return d;
  }

  return undefined;
}

/**
 * Fetch a single article's date from its detail page.
 */
async function fetchArticleDate(article: Article): Promise<Date | undefined> {
  try {
    const html = await fetchHTML(article.link, 10_000, 1);
    return extractDateFromDetailPage(html);
  } catch {
    return undefined;
  }
}

/**
 * Process a batch of articles with concurrency control.
 */
async function processBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Enrich articles that don't have dates by fetching their detail pages.
 * Returns the enriched articles (limited to MAX_ARTICLES).
 */
export async function enrichDates(articles: Article[]): Promise<Article[]> {
  // Check if articles already have dates
  const withDates = articles.filter((a) => a.date != null);
  if (withDates.length > articles.length * 0.5) {
    // More than half have dates, no enrichment needed
    return articles;
  }

  // Take only the first MAX_ARTICLES (they're typically newest-first on the page)
  const toEnrich = articles.slice(0, MAX_ARTICLES);
  const rest = articles.slice(MAX_ARTICLES);

  console.log(
    `  📅 Enriching dates for ${toEnrich.length} articles from detail pages...`
  );

  const dates = await processBatch(
    toEnrich,
    CONCURRENCY,
    fetchArticleDate
  );

  let enriched = 0;
  for (let i = 0; i < toEnrich.length; i++) {
    if (dates[i]) {
      toEnrich[i].date = dates[i];
      enriched++;
    }
  }

  console.log(`  📅 Got dates for ${enriched}/${toEnrich.length} articles`);

  // Return enriched articles only (drop the rest that have no dates)
  // This ensures feed quality: only articles with real dates
  if (enriched > 0) {
    return toEnrich.filter((a) => a.date != null);
  }

  // If no dates found at all, return original limited set
  return toEnrich;
}
