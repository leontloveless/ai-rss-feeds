#!/usr/bin/env bun
/**
 * Deterministic feed adder: detects URL type and uses the right parser mode.
 *
 * Supports:
 *   - GitHub repo URLs → github-releases mode
 *   - GitHub CHANGELOG.md URLs → github-releases mode (uses releases API)
 *   - Blog URLs with native RSS/Atom → external mode
 *   - Other pages → explicit Agentic Workflow fallback marker
 *
 * Usage:
 *   bun run src/add-smart.ts https://github.com/owner/repo
 *   bun run src/add-smart.ts https://github.com/owner/repo/blob/main/CHANGELOG.md
 *   bun run src/add-smart.ts https://example.com/blog
 */

import RSSParser from "rss-parser";
import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { fetchGitHubAPI, tolerantFetch } from "./fetcher.js";
import { parseArticles } from "./parser.js";
import { validateQuick } from "./validator.js";
import { generateRSS } from "./generator.js";
import { saveSnapshot } from "./snapshot.js";
import type { FeedConfig } from "./types.js";

const CONFIGS_DIR = join(import.meta.dir, "..", "configs");
const FEEDS_DIR = join(import.meta.dir, "..", "feeds");
const REPO = "leontloveless/ai-rss-feeds";
const rssParser = new RSSParser({ timeout: 10000, headers: { "User-Agent": "ai-rss-feeds/1.0" } });

const DISCOVERY_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.8",
};

export interface GitHubInfo {
  owner: string;
  repo: string;
}

interface ExistingFeed {
  config: FeedConfig;
  feedUrl: string;
  kind: "native" | "generated";
}

interface DiscoveredFeed {
  url: string;
  title?: string;
  description?: string;
  language?: string;
  author?: string;
}

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href.replace(/\/$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function configFeedUrl(config: FeedConfig): string {
  if (config.parserMode === "external") {
    return config.rssExtraction?.feedUrl || config.url;
  }
  return `https://raw.githubusercontent.com/${REPO}/main/feeds/${config.name}.xml`;
}

function loadConfigs(): FeedConfig[] {
  if (!existsSync(CONFIGS_DIR)) return [];
  return readdirSync(CONFIGS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(CONFIGS_DIR, file), "utf-8")) as FeedConfig);
}

function githubKey(info: GitHubInfo): string {
  return `${info.owner}/${info.repo}`.toLowerCase();
}

function configGitHubInfo(config: FeedConfig): GitHubInfo | null {
  if (config.parserMode === "github-releases" && config.githubReleasesExtraction) {
    return {
      owner: config.githubReleasesExtraction.owner,
      repo: config.githubReleasesExtraction.repo,
    };
  }
  return parseGitHubUrl(config.url);
}

function findExistingFeed(url: string): ExistingFeed | null {
  const requested = normalizeUrl(url);
  const requestedGitHub = parseGitHubUrl(url);
  for (const config of loadConfigs()) {
    const source = normalizeUrl(config.url);
    const upstream = config.rssExtraction?.feedUrl
      ? normalizeUrl(config.rssExtraction.feedUrl)
      : "";
    const configGitHub = configGitHubInfo(config);
    const sameGitHubRepo = requestedGitHub && configGitHub
      ? githubKey(requestedGitHub) === githubKey(configGitHub)
      : false;
    if (requested === source || requested === upstream || sameGitHubRepo) {
      return {
        config,
        feedUrl: configFeedUrl(config),
        kind: config.parserMode === "external" ? "native" : "generated",
      };
    }
  }
  return null;
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    try {
      const normalized = new URL(url).href;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    } catch {
      // ignore invalid candidates
    }
  }
  return result;
}

function addFeedPathCandidates(baseUrl: string, candidates: string[]): void {
  const parsed = new URL(baseUrl);
  const origin = parsed.origin;
  const noSlash = baseUrl.replace(/\/$/, "");
  const pathSegments = parsed.pathname.split("/").filter(Boolean);

  candidates.push(baseUrl);

  if (pathSegments.length > 0) {
    candidates.push(
      `${noSlash}/rss`,
      `${noSlash}/rss/`,
      `${noSlash}/feed`,
      `${noSlash}/feed/`,
      `${noSlash}/feed.xml`,
      `${noSlash}/rss.xml`,
      `${noSlash}/atom.xml`,
      `${noSlash}/index.xml`
    );
  }

  for (const path of [
    "/rss",
    "/rss/",
    "/feed",
    "/feed/",
    "/feed.xml",
    "/rss.xml",
    "/atom.xml",
    "/index.xml",
    "/blog/rss",
    "/blog/rss/",
    "/blog/rss.xml",
    "/blog/feed",
    "/blog/feed/",
    "/blog/feed.xml",
    "/news/rss",
    "/news/rss/",
    "/news/rss.xml",
    "/news/feed",
    "/news/feed/",
    "/news/feed.xml",
  ]) {
    candidates.push(origin + path);
  }
}

function siteDomain(hostname: string): string {
  const parts = hostname.split(".").filter(Boolean);
  return parts.slice(-2).join(".");
}

export async function validateFeedCandidate(feedUrl: string): Promise<DiscoveredFeed | null> {
  try {
    const res = await tolerantFetch(feedUrl, {
      headers: DISCOVERY_HEADERS,
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;

    const text = await res.text();
    const head = text.slice(0, 2000);
    if (!head.includes("<rss") && !head.includes("<feed") && !head.includes("<?xml")) {
      return null;
    }

    const parsed = await rssParser.parseString(text);
    const items = parsed.items ?? [];
    if (items.length === 0) return null;

    const links = items
      .slice(0, 3)
      .map((item) => item.link?.trim())
      .filter((link): link is string => !!link && link.startsWith("http"));
    if (links.length === 0) return null;

    return {
      url: res.url || feedUrl,
      title: parsed.title?.trim(),
      description: parsed.description?.trim(),
      language: parsed.language?.trim(),
      author: (parsed.creator || parsed.author)?.trim(),
    };
  } catch {
    return null;
  }
}

function collectUrlStrings(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrlStrings(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectUrlStrings(child, output);
    }
  }
}

function collectHtmlFeedCandidates(pageUrl: string, html: string): string[] {
  const priorityCandidates: string[] = [];
  const fallbackCandidates: string[] = [];
  const $ = cheerio.load(html);
  const parsedPage = new URL(pageUrl);
  const pageDomain = siteDomain(parsedPage.hostname);
  const preferredSlugs = new Set(
    parsedPage.pathname
      .split("/")
      .filter((segment) => segment && !["blog", "news", "tag", "category"].includes(segment))
  );

  $("link[rel~='alternate']").each((_, el) => {
    const type = ($(el).attr("type") || "").toLowerCase();
    const href = $(el).attr("href");
    if (!href || (!type.includes("rss") && !type.includes("atom") && !type.includes("xml"))) {
      return;
    }
    priorityCandidates.push(new URL(href, pageUrl).href);
  });

  const discoveredUrls = new Set<string>();
  let hasPreferredTagFeed = false;
  $("script[type='application/json'], script#__NEXT_DATA__").each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      collectUrlStrings(JSON.parse(raw), discoveredUrls);
    } catch {
      // ignore non-JSON script tags
    }
  });

  for (const url of discoveredUrls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (siteDomain(parsed.hostname) !== pageDomain) continue;

    const tagMatch = parsed.pathname.match(/\/tag\/([^/]+)\/?$/);
    if (tagMatch) {
      const tagFeed = `${url.replace(/\/$/, "")}/rss/`;
      if (preferredSlugs.has(tagMatch[1])) {
        hasPreferredTagFeed = true;
        priorityCandidates.push(tagFeed);
      } else {
        fallbackCandidates.push(tagFeed);
      }
    }

    if (!/\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(parsed.pathname)) {
      for (const slug of preferredSlugs) {
        priorityCandidates.push(`${parsed.origin}/tag/${slug}/rss/`);
      }
      addFeedPathCandidates(parsed.origin, fallbackCandidates);
    }
  }

  return uniqueUrls(hasPreferredTagFeed ? priorityCandidates : [...priorityCandidates, ...fallbackCandidates]);
}

/**
 * Try to extract GitHub owner/repo from a URL.
 */
export function parseGitHubUrl(raw: string): GitHubInfo | null {
  try {
    const url = new URL(raw);
    if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
      return null;
    }
    const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/i, "");
    if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

interface GitHubReleaseShape {
  draft?: boolean;
  prerelease?: boolean;
}

export function shouldIncludePrereleases(releases: GitHubReleaseShape[]): boolean {
  const published = releases.filter((release) => !release.draft);
  return published.length > 0 && !published.some((release) => !release.prerelease);
}

function uniqueConfigName(preferred: string, info?: GitHubInfo, sourceUrl?: string): string {
  const configs = loadConfigs();
  if (!configs.some((config) => config.name === preferred)) return preferred;

  const alternatives: string[] = [];
  if (info) alternatives.push(`${info.owner}-${info.repo}-releases`);
  if (sourceUrl) {
    const parsed = new URL(sourceUrl);
    const path = parsed.pathname.split("/").filter(Boolean).join("-");
    if (path) alternatives.push(`${preferred}-${path}`);
  }

  for (const candidate of alternatives) {
    const sanitized = sanitizeName(candidate);
    if (!configs.some((config) => config.name === sanitized)) return sanitized;
  }

  for (let suffix = 2; ; suffix++) {
    const candidate = `${preferred}-${suffix}`;
    if (!configs.some((config) => config.name === candidate)) return candidate;
  }
}

async function addGitHubReleasesFeed(info: GitHubInfo): Promise<void> {
  const { owner, repo } = info;
  const name = uniqueConfigName(sanitizeName(`${repo}-releases`), info);

  console.log(`\n🔍 Detected GitHub repo: ${owner}/${repo}`);
  console.log("📦 Fetching releases...");

  const json = await fetchGitHubAPI(owner, repo, 50);
  const releases = JSON.parse(json) as GitHubReleaseShape[];
  const published = releases.filter((release) => !release.draft);
  if (published.length === 0) {
    throw new Error(`No published releases found for ${owner}/${repo}`);
  }
  const includePrerelease = shouldIncludePrereleases(releases);
  console.log(`✅ Fetched releases from API`);
  if (includePrerelease) {
    console.log("ℹ️  This repository only publishes prereleases; including them in the feed");
  }

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
      includePrerelease,
      limit: 50,
    },
    createdAt: new Date().toISOString(),
  };

  // Parse and validate
  const articles = await parseArticles(json, config);
  console.log(`📝 Parsed ${articles.length} releases`);

  if (articles.length === 0) {
    throw new Error("No releases parsed");
  }

  const validation = validateQuick(articles);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join("; ")}`);
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
  process.stdout.write("result=new_generated\n");
  process.stdout.write(`config_name=${name}\n`);
  process.stdout.write(`feed_url=https://raw.githubusercontent.com/${REPO}/main/feeds/${name}.xml\n`);
}

/**
 * Try to discover an existing RSS/Atom feed for a URL.
 * Checks common feed paths and HTML <link> tags.
 */
async function discoverExistingRSS(url: string): Promise<DiscoveredFeed | null> {
  const candidates: string[] = [];
  addFeedPathCandidates(url, candidates);

  try {
    const res = await tolerantFetch(url, {
      headers: DISCOVERY_HEADERS,
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (res.ok) {
      const html = await res.text();
      candidates.push(...collectHtmlFeedCandidates(res.url || url, html));
    }
  } catch {
    // Discovery failures become an explicit deterministic-fallback result.
  }

  for (const candidate of uniqueUrls(candidates)) {
    const valid = await validateFeedCandidate(candidate);
    if (valid) return valid;
  }

  return null;
}

async function main() {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) {
    console.error("Usage: bun run src/add-smart.ts <url>");
    console.error("  Supports: GitHub repositories and pages with native RSS/Atom feeds");
    process.exit(1);
  }

  // Check if this request is already covered before doing any work.
  const existing = findExistingFeed(url);
  if (existing) {
    console.log(`\n✅ Existing feed already configured: ${existing.config.name}`);
    console.log(`📖 Subscribe: ${existing.feedUrl}`);
    process.stdout.write(`existing_feed_url=${existing.feedUrl}\n`);
    process.stdout.write(`existing_config_name=${existing.config.name}\n`);
    process.stdout.write(`existing_feed_kind=${existing.kind}\n`);
    process.stdout.write("result=existing\n");
    return;
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
    console.log(`\n✅ Native RSS feed found: ${existingFeed.url}`);
    // Create minimal config for README tracking (parserMode=external, no generated feed file)
    const name = uniqueConfigName(deriveConfigName(url), undefined, url);
    const hostname = new URL(url).hostname;
    const config: FeedConfig = {
      name,
      url,
      feed: {
        title: existingFeed.title || hostname,
        description: existingFeed.description || `External RSS: ${existingFeed.url}`,
        language: existingFeed.language || "en",
        author: existingFeed.author || hostname,
      },
      selectors: { articleList: "", title: "", link: { source: "" } },
      parserMode: "external",
      rssExtraction: { feedUrl: existingFeed.url },
      createdAt: new Date().toISOString(),
    };
    mkdirSync(CONFIGS_DIR, { recursive: true });
    writeFileSync(join(CONFIGS_DIR, `${name}.json`), JSON.stringify(config, null, 2));
    console.log(`   Config: configs/${name}.json (external)`);
    console.log(`📖 Subscribe: ${existingFeed.url}`);
    process.stdout.write(`native_feed_url=${existingFeed.url}\n`);
    process.stdout.write(`config_name=${name}\n`);
    process.stdout.write(`feed_url=${existingFeed.url}\n`);
    process.stdout.write("result=new_native\n");
    return;
  }

  console.log("ℹ️  No native RSS/Atom feed was found; deterministic handling is not available.");
  console.log("   Apply the agentic-feed label or run Add Feed (Agentic Fallback) manually.");
  process.stdout.write("result=agentic_fallback\n");
  process.stdout.write("fallback_reason=no_native_feed\n");
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function deriveConfigName(url: string): string {
  const parsed = new URL(url);
  const parts = parsed.hostname.split(".");
  const slug = parts.length > 2
    ? parts.slice(-2).join("-")
    : parts.join("-");
  return sanitizeName(slug);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
}
