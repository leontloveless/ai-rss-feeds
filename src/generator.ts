/**
 * Article[] → RSS 2.0 XML using the `feed` library.
 */

import { Feed } from "feed";
import type { Article, FeedConfig } from "./types.js";

const MAX_ITEMS = 50; // Limit RSS feed to 50 most recent items

export function generateRSS(articles: Article[], config: FeedConfig): string {
  const siteUrl = config.url;
  const feedUrl = `https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/${config.name}.xml`;

  // Stable fallback date for articles without dates — avoids generating
  // a new timestamp on every CI run which causes meaningless diffs.
  const fallbackDate = new Date(config.createdAt || "2026-01-01T00:00:00Z");

  // Sort by date descending (newest first), then limit to MAX_ITEMS
  const sorted = [...articles].sort((a, b) => {
    const da = a.date?.getTime() ?? 0;
    const db = b.date?.getTime() ?? 0;
    return db - da;
  });
  const limited = sorted.slice(0, MAX_ITEMS);

  // Feed updated = newest article date, or fallback
  const latestDate = limited.find((a) => a.date)?.date || fallbackDate;

  const feed = new Feed({
    title: config.feed.title,
    description: config.feed.description,
    id: siteUrl,
    link: siteUrl,
    language: config.feed.language,
    feedLinks: { rss: feedUrl },
    copyright: "",
    author: config.feed.author
      ? { name: config.feed.author }
      : undefined,
    updated: latestDate,
    generator: "ai-rss-feeds (https://github.com/leontloveless/ai-rss-feeds)",
  });

  for (const article of limited) {
    feed.addItem({
      title: article.title,
      id: article.link,
      link: article.link,
      description: article.description || "",
      content: article.content,
      date: article.date || fallbackDate,
    });
  }

  return feed.rss2();
}
