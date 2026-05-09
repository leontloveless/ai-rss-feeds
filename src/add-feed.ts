#!/usr/bin/env bun
/**
 * Add a new feed: fetch HTML → LLM generates config → validate → save.
 *
 * Usage:
 *   bun run src/add-feed.ts https://ollama.com/blog
 *   GITHUB_TOKEN=xxx bun run src/add-feed.ts https://example.com/blog
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { fetchHTML } from "./fetcher.js";
import { generateConfig } from "./llm.js";
import { parseArticles } from "./parser.js";
import { validateQuick } from "./validator.js";
import { generateRSS } from "./generator.js";
import { saveSnapshot } from "./snapshot.js";
import type { Article, FeedConfig } from "./types.js";

const CONFIGS_DIR = join(import.meta.dir, "..", "configs");
const FEEDS_DIR = join(import.meta.dir, "..", "feeds");
const MAX_PARSE_ATTEMPTS = 3;

async function main() {
  const url = process.argv[2];
  if (!url || !url.startsWith("http")) {
    console.error("Usage: bun run src/add-feed.ts <blog-url>");
    console.error("Example: bun run src/add-feed.ts https://ollama.com/blog");
    process.exit(1);
  }

  console.log(`\n🆕 Adding feed for: ${url}\n`);

  // 1. Fetch HTML
  console.log("⬇️  Fetching HTML...");
  const html = await fetchHTML(url);
  console.log(`✅ Fetched ${(html.length / 1024).toFixed(1)}KB`);

  // 2. Generate config + verify it parses; on 0 articles, feed the failing
  //    selectors back to the LLM and try again (sites with hashed class names
  //    or shifted markup often need 1–2 corrections).
  let config: FeedConfig | undefined;
  let articles: Article[] = [];
  let feedback: string | undefined;

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    console.log(
      `🤖 Generating config via LLM (attempt ${attempt}/${MAX_PARSE_ATTEMPTS})...`
    );
    config = await generateConfig(url, html, feedback);
    config.createdAt = new Date().toISOString();
    console.log(`✅ Config generated: "${config.name}"`);

    console.log("📝 Parsing articles...");
    articles = await parseArticles(html, config);
    console.log(`   Found ${articles.length} articles`);

    if (articles.length > 0) break;

    feedback =
      `Your previous selectors produced 0 articles when applied to this exact HTML. ` +
      `Selectors used: ${JSON.stringify(config.selectors)}. ` +
      `The articleList selector "${config.selectors.articleList}" matched no elements. ` +
      `Pick selectors that actually exist in the HTML below — avoid hashed CSS-Modules class names ` +
      `(e.g. "Foo-module-scss-module__abc123__bar"), prefer stable tags/attributes (article, h1-h3, ` +
      `data-* attributes, or simple class names). If the page is a JavaScript-rendered SPA with no ` +
      `article markup in the static HTML, return parserMode "json" with jsonExtraction targeting ` +
      `the __NEXT_DATA__ script and the appropriate dataPath.`;
    console.warn(`⚠️  No articles parsed; retrying with feedback to LLM...`);
  }

  if (!config || articles.length === 0) {
    console.error("❌ No articles found after all attempts.");
    if (config) {
      console.error("   Last config:", JSON.stringify(config.selectors, null, 2));
    }
    console.error(
      "   This site may be a JavaScript-rendered SPA, or use unusual structure."
    );
    process.exit(1);
  }

  const validation = validateQuick(articles);
  if (!validation.valid) {
    console.error("❌ Validation failed:", validation.errors);
    process.exit(1);
  }
  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      console.warn(`⚠️  ${w}`);
    }
  }

  // 4. Generate RSS
  const xml = generateRSS(articles, config);

  // 5. Save config, feed, and snapshot
  mkdirSync(CONFIGS_DIR, { recursive: true });
  mkdirSync(FEEDS_DIR, { recursive: true });

  writeFileSync(
    join(CONFIGS_DIR, `${config.name}.json`),
    JSON.stringify(config, null, 2)
  );
  writeFileSync(join(FEEDS_DIR, `${config.name}.xml`), xml);
  saveSnapshot(config.name, articles);

  console.log(`\n✅ Feed added successfully!`);
  console.log(`   Config: configs/${config.name}.json`);
  console.log(`   Feed:   feeds/${config.name}.xml`);
  console.log(`   Items:  ${articles.length}`);
  console.log(
    `\n📖 Subscribe: https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/${config.name}.xml`
  );
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
