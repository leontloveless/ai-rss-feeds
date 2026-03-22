#!/usr/bin/env bun
/**
 * Update all feeds: fetch HTML → parse → validate → generate RSS → save.
 *
 * Usage:
 *   bun run src/run-all.ts                  # update all
 *   bun run src/run-all.ts --name ollama    # update one
 *   bun run src/run-all.ts --validate-only  # validate without writing
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { FeedConfig } from "./types.js";
import { fetchHTML, fetchGitHubAPI } from "./fetcher.js";
import { enrichDates } from "./date-enricher.js";
import { parseArticles } from "./parser.js";
import { validate, validateQuick } from "./validator.js";
import { generateRSS } from "./generator.js";
import { loadSnapshot, saveSnapshot, recordError } from "./snapshot.js";

const CONFIGS_DIR = join(import.meta.dir, "..", "configs");
const FEEDS_DIR = join(import.meta.dir, "..", "feeds");

function loadConfigs(filterName?: string): FeedConfig[] {
  const files = readdirSync(CONFIGS_DIR).filter((f) => f.endsWith(".json"));
  const configs: FeedConfig[] = [];

  for (const file of files) {
    const config = JSON.parse(
      readFileSync(join(CONFIGS_DIR, file), "utf-8")
    ) as FeedConfig;
    if (filterName && config.name !== filterName) continue;
    configs.push(config);
  }

  return configs;
}

async function processFeed(
  config: FeedConfig,
  validateOnly: boolean
): Promise<boolean> {
  const name = config.name;
  console.log(`\n📡 ${name} (${config.url})`);

  try {
    // 1. Fetch content
    let html: string;
    if (config.parserMode === "github-releases" && config.githubReleasesExtraction) {
      const ext = config.githubReleasesExtraction;
      console.log(`  ⬇️  Fetching GitHub Releases API (${ext.owner}/${ext.repo})...`);
      html = await fetchGitHubAPI(ext.owner, ext.repo, ext.limit);
      console.log(`  ✅ Fetched ${(html.length / 1024).toFixed(1)}KB from API`);
    } else {
      console.log("  ⬇️  Fetching HTML...");
      html = await fetchHTML(config.url);
      console.log(`  ✅ Fetched ${(html.length / 1024).toFixed(1)}KB`);
    }

    // 2. Parse articles
    let articles = parseArticles(html, config);
    console.log(`  📝 Parsed ${articles.length} articles`);

    if (articles.length === 0) {
      console.error("  ❌ No articles found");
      recordError(name, "No articles parsed");
      return false;
    }

    // 2.5. Enrich dates from detail pages if needed
    const datedCount = articles.filter((a) => a.date != null).length;
    if (datedCount < articles.length * 0.5 && config.parserMode !== "github-releases") {
      articles = await enrichDates(articles);
    }

    // 3. Generate RSS
    const xml = generateRSS(articles, config);

    // 4. Validate
    const snapshot = loadSnapshot(name);

    if (validateOnly) {
      const result = validateQuick(articles);
      if (result.errors.length > 0) {
        console.error("  ❌ Validation errors:", result.errors);
        return false;
      }
      if (result.warnings.length > 0) {
        console.warn("  ⚠️  Warnings:", result.warnings);
      }
      console.log("  ✅ Quick validation passed");
      return true;
    }

    const result = await validate(articles, xml, snapshot);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.warn(`  ⚠️  ${w}`);
      }
    }

    if (!result.valid) {
      console.error("  ❌ Validation failed:");
      for (const e of result.errors) {
        console.error(`     ${e}`);
      }
      recordError(name, result.errors.join("; "));
      return false;
    }

    // 5. Write feed + snapshot
    mkdirSync(FEEDS_DIR, { recursive: true });
    writeFileSync(join(FEEDS_DIR, `${name}.xml`), xml);
    saveSnapshot(name, articles);

    console.log(`  ✅ Feed written: feeds/${name}.xml (${articles.length} items)`);
    return true;
  } catch (err) {
    console.error(`  ❌ Error: ${(err as Error).message}`);
    recordError(name, (err as Error).message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const validateOnly = args.includes("--validate-only");
  const nameIdx = args.indexOf("--name");
  const filterName = nameIdx !== -1 ? args[nameIdx + 1] : undefined;

  console.log("🔄 ai-rss-feeds updater");
  console.log(`   Mode: ${validateOnly ? "validate-only" : "update"}`);

  const configs = loadConfigs(filterName);
  if (configs.length === 0) {
    console.log("   No configs found.");
    return;
  }

  console.log(`   Feeds: ${configs.length}`);

  let success = 0;
  let failed = 0;

  for (const config of configs) {
    const ok = await processFeed(config, validateOnly);
    if (ok) success++;
    else failed++;
  }

  console.log(`\n📊 Results: ${success} success, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
