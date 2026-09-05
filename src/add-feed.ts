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
import { parseArticles, validateSelectorSyntax } from "./parser.js";
import { validateQuick } from "./validator.js";
import { generateRSS } from "./generator.js";
import { saveSnapshot } from "./snapshot.js";
import type { Article, FeedConfig } from "./types.js";

const CONFIGS_DIR = join(import.meta.dir, "..", "configs");
const FEEDS_DIR = join(import.meta.dir, "..", "feeds");
const MAX_PARSE_ATTEMPTS = 3;

function selectorFeedback(config: FeedConfig, errors: string[]): string {
  return (
    `Your previous FeedConfig used invalid CSS selector syntax.\n` +
    `Selector errors:\n${errors.map((e) => `- ${e}`).join("\n")}\n\n` +
    `Selectors used: ${JSON.stringify(config.selectors)}.\n` +
    `Selectors must be valid Cheerio/css-select syntax. If you use a class name ` +
    `containing ":" (for example Tailwind "hover:underline"), escape the colon ` +
    `as "\\:" in the JSON string, or choose a more stable structural selector ` +
    `such as article, a[href], h1-h3, time, or data-* attributes.`
  );
}

function parseFeedback(config: FeedConfig, err: unknown): string {
  return (
    `Your previous FeedConfig crashed the deterministic parser.\n` +
    `Parser error: ${(err as Error).message}\n\n` +
    `Selectors used: ${JSON.stringify(config.selectors)}.\n` +
    `Return a corrected FeedConfig whose selectors can be executed by Cheerio. ` +
    `Avoid raw Tailwind variant classes such as ".hover:underline"; escape ":" ` +
    `as "\\:" or use stable structural selectors.`
  );
}

function emptyArticlesFeedback(config: FeedConfig): string {
  return (
    `Your previous selectors produced 0 articles when applied to this exact HTML. ` +
    `Selectors used: ${JSON.stringify(config.selectors)}. ` +
    `The articleList selector "${config.selectors.articleList}" matched no usable articles. ` +
    `Pick selectors that actually exist in the HTML below; avoid hashed CSS-Modules class names ` +
    `(e.g. "Foo-module-scss-module__abc123__bar"), prefer stable tags/attributes (article, h1-h3, ` +
    `data-* attributes, or simple class names). If the page is a JavaScript-rendered SPA with no ` +
    `article markup in the static HTML, return parserMode "json" with jsonExtraction targeting ` +
    `the __NEXT_DATA__ script and the appropriate dataPath.`
  );
}

function validationFeedback(config: FeedConfig, articles: Article[], errors: string[]): string {
  const sample = articles.slice(0, 3).map((a) => ({
    title: a.title,
    link: a.link,
    date: a.date?.toISOString(),
  }));
  return (
    `Your previous FeedConfig parsed articles, but they failed validation.\n` +
    `Validation errors:\n${errors.map((e) => `- ${e}`).join("\n")}\n\n` +
    `Selectors used: ${JSON.stringify(config.selectors)}.\n` +
    `Sample parsed articles: ${JSON.stringify(sample)}.\n` +
    `Return corrected selectors that produce non-empty titles and absolute http(s) links without duplicates.`
  );
}

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

  // 2. Generate config + verify it parses and validates. Any failed stage
  //    becomes feedback for the next LLM attempt instead of crashing early.
  let config: FeedConfig | undefined;
  let articles: Article[] = [];
  let feedback: string | undefined;
  let lastFailure = "";
  let readyToSave = false;

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    articles = [];
    console.log(
      `🤖 Generating config via LLM (attempt ${attempt}/${MAX_PARSE_ATTEMPTS})...`
    );
    config = await generateConfig(url, html, feedback);
    config.createdAt = new Date().toISOString();
    console.log(`✅ Config generated: "${config.name}"`);

    const selectorErrors = validateSelectorSyntax(config);
    if (selectorErrors.length > 0) {
      lastFailure = selectorErrors.join("; ");
      feedback = selectorFeedback(config, selectorErrors);
      console.warn("⚠️  Config has invalid selector syntax; retrying with feedback to LLM...");
      continue;
    }

    console.log("📝 Parsing articles...");
    try {
      articles = await parseArticles(html, config);
    } catch (err) {
      lastFailure = (err as Error).message;
      feedback = parseFeedback(config, err);
      console.warn(`⚠️  Parser failed: ${lastFailure}; retrying with feedback to LLM...`);
      continue;
    }
    console.log(`   Found ${articles.length} articles`);

    if (articles.length === 0) {
      lastFailure = "No articles found";
      feedback = emptyArticlesFeedback(config);
      console.warn(`⚠️  No articles parsed; retrying with feedback to LLM...`);
      continue;
    }

    const validation = validateQuick(articles);
    if (!validation.valid) {
      lastFailure = validation.errors.join("; ");
      feedback = validationFeedback(config, articles, validation.errors);
      console.warn("⚠️  Parsed articles failed validation; retrying with feedback to LLM...");
      continue;
    }
    if (validation.warnings.length > 0) {
      for (const w of validation.warnings) {
        console.warn(`⚠️  ${w}`);
      }
    }

    readyToSave = true;
    break;
  }

  if (!config || !readyToSave) {
    console.error("❌ Failed to generate a valid feed config after all attempts.");
    if (config) {
      console.error("   Last config:", JSON.stringify(config.selectors, null, 2));
    }
    if (lastFailure) {
      console.error(`   Last failure: ${lastFailure}`);
    }
    console.error(
      "   This site may be a JavaScript-rendered SPA, or use unusual structure."
    );
    process.exit(1);
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
