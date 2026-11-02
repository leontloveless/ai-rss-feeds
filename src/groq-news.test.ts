import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import RSSParser from "rss-parser";
import configJson from "../configs/groq-news.json";
import { generateRSS } from "./generator.js";
import { parseArticles, validateSelectorSyntax } from "./parser.js";
import type { FeedConfig } from "./types.js";
import { validateQuick } from "./validator.js";

const config = configJson as FeedConfig;
const html = readFileSync(join(import.meta.dir, "fixtures/groq-news.html"), "utf8");

test("Groq News cards preserve RSS fields and deduplicate links", async () => {
  expect(validateSelectorSyntax(config)).toEqual([]);

  const articles = await parseArticles(html, config);
  expect(articles).toHaveLength(2);
  expect(articles.map(({ title, link }) => ({ title, link }))).toEqual([
    {
      title: "Meta's Muse Spark open-weight release Is Now in Limited Preview on GroqCloud",
      link: "https://groq.com/blog/meta-s-muse-spark-open-release-is-now-in-limited-preview-on-groqcloud",
    },
    {
      title: "Groq Closes $350 million Series A, Building the World's Leading AI Inference Cloud",
      link: "https://groq.com/newsroom/groq-closes-usd350-million-series-a-building-the-world-s-leading-ai-inference-cloud",
    },
  ]);
  expect(articles.map((article) => article.date?.getFullYear())).toEqual([2026, 2026]);
  expect(articles.map((article) => article.date?.getMonth())).toEqual([9, 7]);
  expect(articles.map((article) => article.date?.getDate())).toEqual([15, 17]);
  expect(validateQuick(articles).valid).toBe(true);

  const feed = await new RSSParser().parseString(generateRSS(articles, config));
  expect(feed.title).toBe("Groq News");
  expect(feed.items.map((item) => item.link)).toEqual(articles.map((article) => article.link));
  expect(feed.items.map((item) => item.title)).toEqual(articles.map((article) => article.title));
  expect(feed.items.every((item) => !!item.pubDate)).toBe(true);
});
