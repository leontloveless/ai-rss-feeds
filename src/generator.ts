/**
 * Article[] → RSS 2.0 XML using the `feed` library.
 */

import { Feed } from "feed";
import type { Article, FeedConfig } from "./types.js";

export function generateRSS(articles: Article[], config: FeedConfig): string {
  const siteUrl = config.url;
  const feedUrl = `https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/${config.name}.xml`;

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
    updated: articles[0]?.date || new Date(),
    generator: "ai-rss-feeds (https://github.com/leontloveless/ai-rss-feeds)",
  });

  for (const article of articles) {
    feed.addItem({
      title: article.title,
      id: article.link,
      link: article.link,
      description: article.description || "",
      content: article.content,
      date: article.date || new Date(),
    });
  }

  return feed.rss2();
}
