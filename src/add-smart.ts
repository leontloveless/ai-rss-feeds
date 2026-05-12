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

import RSSParser from "rss-parser";
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
const rssParser = new RSSParser({ timeout: 10000, headers: { "User-Agent": "ai-rss-feeds/1.0" } });

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
  const articles = await parseArticles(json, config);
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

/**
 * Try to discover an existing RSS/Atom feed for a URL.
 * Checks common feed paths and HTML <link> tags.
 */
async function discoverExistingRSS(url: string): Promise<string | null> {
  const origin = new URL(url).origin;
  const parsedUrl = new URL(url);
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);

  // Strategy 1: If URL has path segments (e.g. /tag/ai/), try appending /rss
  // to the full path first, then fall back to just /rss
  if (pathSegments.length > 0) {
    const pathBasedFeed = url.replace(/\/$/, "") + "/rss";
    try {
      const res = await fetch(pathBasedFeed, {
        method: "HEAD",
        headers: { "User-Agent": "ai-rss-feeds/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok && (res.headers.get("content-type") || "").includes("xml")) {
        return pathBasedFeed;
      }
    } catch { /* ignore */ }
  }

  // Strategy 2: Check /rss at origin root
  try {
    const res = await fetch(origin + "/rss", {
      method: "HEAD",
      headers: { "User-Agent": "ai-rss-feeds/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok && (res.headers.get("content-type") || "").includes("xml")) {
      return origin + "/rss";
    }
  } catch { /* ignore */ }

  // Strategy 3: Common feed paths
  const commonPaths = [
    "/feed", "/feed.xml", "/rss.xml",
    "/atom.xml", "/index.xml", "/blog/rss.xml",
    "/news/rss.xml", "/blog/feed", "/news/feed",
  ];

  for (const path of commonPaths) {
    try {
      const feedUrl = origin + path;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(feedUrl, {
        method: "HEAD",
        headers: { "User-Agent": "ai-rss-feeds/1.0" },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (
          ct.includes("xml") ||
          ct.includes("rss") ||
          ct.includes("atom")
        ) {
          return feedUrl;
        }
        // Some servers return text/html for feed URLs, do a GET to check
        const getRes = await fetch(feedUrl, {
          headers: { "User-Agent": "ai-rss-feeds/1.0" },
          signal: AbortSignal.timeout(5000),
        });
        const text = await getRes.text();
        if (
          text.trimStart().startsWith("<?xml") ||
          text.includes("<rss") ||
          text.includes("<feed")
        ) {
          return feedUrl;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
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

  // Check if the site already has a native RSS feed
  console.log("🔍 Checking for existing RSS feed...");
  const existingFeed = await discoverExistingRSS(url);
  if (existingFeed) {
    console.log(`\n✅ Native RSS feed found: ${existingFeed}`);
    console.log(`📖 Subscribe: ${existingFeed}`);
    // Output for GitHub Actions: discovered native feed URL
    process.stdout.write(`native_feed_url=${existingFeed}`);
    process.exit(0);
  }

  // Fall back to LLM-based add-feed
  console.log("🌐 No existing RSS found, using LLM-based parser...\n");

  // Dynamic import to avoid loading LLM deps when not needed
  const { execSync } = await import("child_process");
  execSync(`bun run src/add-feed.ts "${url}"`, { stdio: "inherit" });
}

async function addRssMirrorFeed(originalUrl: string, feedUrl: string): Promise<void> {
  console.log(`\n🔍 Found native RSS feed: ${feedUrl}`);
  console.log("📦 Fetching upstream feed...");

  const response = await fetch(feedUrl, {
    headers: { "User-Agent": "ai-rss-feeds/1.0" },
  });
  if (!response.ok) {
    console.error(`❌ Failed to fetch feed: ${response.status}`);
    process.exit(1);
  }
  const xml = await response.text();

  const parsed = await rssParser.parseString(xml);
  const feedTitle = (parsed.title || new URL(originalUrl).hostname)?.trim();
  const feedDescription = (parsed.description || `RSS mirror of ${originalUrl}`)?.trim();

  const name = deriveConfigName(originalUrl);

  const config: FeedConfig = {
    name,
    url: originalUrl,
    feed: {
      title: feedTitle,
      description: feedDescription,
      language: parsed.language || "en",
      author: parsed.creator || parsed.author || new URL(originalUrl).hostname,
    },
    selectors: { articleList: "", title: "", link: { source: "" } },
    parserMode: "rss",
    rssExtraction: { feedUrl },
    createdAt: new Date().toISOString(),
  };

  const articles = await parseArticles(xml, config);
  console.log(`📝 Parsed ${articles.length} articles`);

  if (articles.length === 0) {
    console.error("❌ No articles parsed from RSS");
    process.exit(1);
  }

  const validation = validateQuick(articles);
  if (!validation.valid) {
    console.error("❌ Validation failed:", validation.errors);
    process.exit(1);
  }

  const rssXml = generateRSS(articles, config);

  mkdirSync(CONFIGS_DIR, { recursive: true });
  mkdirSync(FEEDS_DIR, { recursive: true });

  writeFileSync(join(CONFIGS_DIR, `${name}.json`), JSON.stringify(config, null, 2));
  writeFileSync(join(FEEDS_DIR, `${name}.xml`), rssXml);
  saveSnapshot(name, articles);

  console.log(`\n✅ Feed added successfully!`);
  console.log(`   Config: configs/${name}.json`);
  console.log(`   Feed:   feeds/${name}.xml`);
  console.log(`   Items:  ${articles.length}`);
  console.log(
    `\n📖 Subscribe: https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/${name}.xml`
  );
}

function deriveConfigName(url: string): string {
  const parsed = new URL(url);
  const parts = parsed.hostname.split(".");
  const slug = parts.length > 2
    ? parts.slice(-2).join("-")
    : parts.join("-");
  return slug.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
