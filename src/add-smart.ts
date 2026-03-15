#!/usr/bin/env bun
/**
 * Smart feed adder: detects URL type and uses the right parser mode.
 *
 * Supports:
 *   - GitHub repo URLs → github-releases mode
 *   - GitHub CHANGELOG.md URLs → github-releases mode (uses releases API)
 *   - Blog URLs → LLM-based CSS/JSON mode (delegates to add-feed.ts)
 *
 * Usage:
 *   bun run src/add-smart.ts https://github.com/owner/repo
 *   bun run src/add-smart.ts https://github.com/owner/repo/blob/main/CHANGELOG.md
 *   bun run src/add-smart.ts https://example.com/blog
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { fetchGitHubAPI } from "./fetcher.js";
import { parseArticles } from "./parser.js";
import { validateQuick } from "./validator.js";
import { generateRSS } from "./generator.js";
import { saveSnapshot } from "./snapshot.js";
import type { FeedConfig } from "./types.js";

const CONFIGS_DIR = join(import.meta.dir, "..", "configs");
const FEEDS_DIR = join(import.meta.dir, "..", "feeds");

interface GitHubInfo {
  owner: string;
  repo: string;
}

/**
 * Try to extract GitHub owner/repo from a URL.
 */
function parseGitHubUrl(url: string): GitHubInfo | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\/|\.git|$)/
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Check if a GitHub repo has releases.
 */
async function hasGitHubReleases(owner: string, repo: string): Promise<boolean> {
  try {
    const json = await fetchGitHubAPI(owner, repo, 1);
    const releases = JSON.parse(json);
    return Array.isArray(releases) && releases.length > 0;
  } catch {
    return false;
  }
}

async function addGitHubReleasesFeed(info: GitHubInfo): Promise<void> {
  const { owner, repo } = info;
  const name = `${repo}-releases`;

  console.log(`\n🔍 Detected GitHub repo: ${owner}/${repo}`);
  console.log("📦 Checking for releases...");

  const hasReleases = await hasGitHubReleases(owner, repo);
  if (!hasReleases) {
    console.error(`❌ No releases found for ${owner}/${repo}`);
    process.exit(1);
  }

  console.log("✅ Releases found, creating github-releases feed...\n");

  // Fetch releases
  const json = await fetchGitHubAPI(owner, repo, 50);
  console.log(`✅ Fetched releases from API`);

  // Build config
  const config: FeedConfig = {
    name,
    url: `https://github.com/${owner}/${repo}/releases`,
    feed: {
      title: `${repo} Releases`,
      description: `GitHub releases for ${owner}/${repo}`,
      language: "en",
      author: owner,
    },
    selectors: { articleList: "", title: "", link: { source: "" } },
    parserMode: "github-releases",
    githubReleasesExtraction: {
      owner,
      repo,
      includePrerelease: false,
      limit: 50,
    },
    createdAt: new Date().toISOString(),
  };

  // Parse and validate
  const articles = parseArticles(json, config);
  console.log(`📝 Parsed ${articles.length} releases`);

  if (articles.length === 0) {
    console.error("❌ No releases parsed");
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

  // Generate RSS
  const xml = generateRSS(articles, config);

  // Save
  mkdirSync(CONFIGS_DIR, { recursive: true });
  mkdirSync(FEEDS_DIR, { recursive: true });

  writeFileSync(join(CONFIGS_DIR, `${name}.json`), JSON.stringify(config, null, 2));
  writeFileSync(join(FEEDS_DIR, `${name}.xml`), xml);
  saveSnapshot(name, articles);

  console.log(`\n✅ Feed added successfully!`);
  console.log(`   Config: configs/${name}.json`);
  console.log(`   Feed:   feeds/${name}.xml`);
  console.log(`   Items:  ${articles.length}`);
  console.log(
    `\n📖 Subscribe: https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/${name}.xml`
  );
}

async function main() {
  const url = process.argv[2];
  if (!url || !url.startsWith("http")) {
    console.error("Usage: bun run src/add-smart.ts <url>");
    console.error("  Supports: GitHub repos, CHANGELOG.md URLs, blog URLs");
    process.exit(1);
  }

  // Check if it's a GitHub URL
  const ghInfo = parseGitHubUrl(url);
  if (ghInfo) {
    await addGitHubReleasesFeed(ghInfo);
    return;
  }

  // Fall back to LLM-based add-feed
  console.log("🌐 Not a GitHub repo URL, falling back to LLM-based parser...\n");

  // Dynamic import to avoid loading LLM deps when not needed
  const { execSync } = await import("child_process");
  execSync(`bun run src/add-feed.ts "${url}"`, { stdio: "inherit" });
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
