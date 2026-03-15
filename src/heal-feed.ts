#!/usr/bin/env bun
/**
 * Self-healing: re-generate a feed's config when the parser is broken.
 *
 * Usage:
 *   GITHUB_TOKEN=xxx bun run src/heal-feed.ts ollama
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { FeedConfig } from "./types.js";
import { fetchHTML } from "./fetcher.js";
import { generateConfig } from "./llm.js";
import { parseArticles } from "./parser.js";
import { validateQuick } from "./validator.js";

const CONFIGS_DIR = join(import.meta.dir, "..", "configs");

async function main() {
  const feedName = process.argv[2];
  if (!feedName) {
    console.error("Usage: bun run src/heal-feed.ts <feed-name>");
    process.exit(1);
  }

  const configPath = join(CONFIGS_DIR, `${feedName}.json`);
  if (!existsSync(configPath)) {
    console.error(`❌ Config not found: ${configPath}`);
    process.exit(1);
  }

  const oldConfig = JSON.parse(
    readFileSync(configPath, "utf-8")
  ) as FeedConfig;
  console.log(`\n🔧 Healing feed: ${feedName} (${oldConfig.url})\n`);

  // 1. Fetch current HTML
  console.log("⬇️  Fetching HTML...");
  const html = await fetchHTML(oldConfig.url);

  // 2. Try current config first
  const currentArticles = parseArticles(html, oldConfig);
  const currentValidation = validateQuick(currentArticles);

  if (currentValidation.valid && currentArticles.length > 0) {
    console.log(
      `✅ Current config still works! (${currentArticles.length} articles)`
    );
    console.log("   No healing needed.");
    return;
  }

  console.log(
    `⚠️  Current config broken: ${currentArticles.length} articles, ${currentValidation.errors.length} errors`
  );

  // 3. Generate new config via LLM
  console.log("🤖 Generating new config via LLM...");
  const newConfig = await generateConfig(oldConfig.url, html);

  // Preserve original metadata
  newConfig.name = oldConfig.name;
  newConfig.createdAt = oldConfig.createdAt;
  newConfig.lastHealed = new Date().toISOString();

  // 4. Validate new config
  const newArticles = parseArticles(html, newConfig);
  const newValidation = validateQuick(newArticles);

  if (!newValidation.valid || newArticles.length === 0) {
    console.error("❌ New config also doesn't work:");
    console.error("   Articles:", newArticles.length);
    console.error("   Errors:", newValidation.errors);
    process.exit(1);
  }

  // 5. Save updated config
  writeFileSync(configPath, JSON.stringify(newConfig, null, 2));

  console.log(`\n✅ Feed healed!`);
  console.log(`   Old selectors: ${JSON.stringify(oldConfig.selectors.articleList)}`);
  console.log(`   New selectors: ${JSON.stringify(newConfig.selectors.articleList)}`);
  console.log(`   Articles: ${newArticles.length}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
