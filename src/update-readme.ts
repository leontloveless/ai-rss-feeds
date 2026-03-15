#!/usr/bin/env bun
/**
 * Auto-generate README.md feed tables from configs/ and feeds/.
 * Reads all config files, counts items from generated XMLs, updates README.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { FeedConfig } from "./types.js";

const ROOT = join(import.meta.dir, "..");
const CONFIGS_DIR = join(ROOT, "configs");
const FEEDS_DIR = join(ROOT, "feeds");
const README_PATH = join(ROOT, "README.md");

const REPO = "leontloveless/ai-rss-feeds";

// Markers in README for auto-generated sections
const START_MARKER = "<!-- FEEDS_TABLE_START -->";
const END_MARKER = "<!-- FEEDS_TABLE_END -->";

interface FeedInfo {
  name: string;
  config: FeedConfig;
  itemCount: number;
}

function countItems(feedName: string): number {
  const xmlPath = join(FEEDS_DIR, `${feedName}.xml`);
  if (!existsSync(xmlPath)) return 0;
  const xml = readFileSync(xmlPath, "utf-8");
  return (xml.match(/<item>/g) || []).length;
}

function loadAllFeeds(): FeedInfo[] {
  const files = readdirSync(CONFIGS_DIR).filter((f) => f.endsWith(".json"));
  const feeds: FeedInfo[] = [];

  for (const file of files) {
    const config = JSON.parse(
      readFileSync(join(CONFIGS_DIR, file), "utf-8")
    ) as FeedConfig;
    const itemCount = countItems(config.name);
    feeds.push({ name: config.name, config, itemCount });
  }

  return feeds;
}

function getSourceUrl(config: FeedConfig): string {
  if (config.parserMode === "github-releases" && config.githubReleasesExtraction) {
    const { owner, repo } = config.githubReleasesExtraction;
    return `https://github.com/${owner}/${repo}`;
  }
  return config.url;
}

function getSourceLabel(config: FeedConfig): string {
  if (config.parserMode === "github-releases" && config.githubReleasesExtraction) {
    const { owner, repo } = config.githubReleasesExtraction;
    return `${owner}/${repo}`;
  }
  return config.feed.title;
}

function getItemLabel(config: FeedConfig, count: number): string {
  if (config.parserMode === "github-releases") {
    return `${count} releases`;
  }
  if (config.parserMode === "changelog") {
    return `${count} versions`;
  }
  return `${count} articles`;
}

function generateTable(feeds: FeedInfo[]): string {
  const blogs = feeds.filter(
    (f) => f.config.parserMode !== "github-releases" && f.config.parserMode !== "changelog"
  );
  const releases = feeds.filter(
    (f) => f.config.parserMode === "github-releases"
  );
  const changelogs = feeds.filter(
    (f) => f.config.parserMode === "changelog"
  );

  const lines: string[] = [];

  if (blogs.length > 0) {
    lines.push("### Blogs\n");
    lines.push("| Blog | Feed | Status |");
    lines.push("|------|------|--------|");
    for (const f of blogs) {
      const source = `[${f.config.feed.title}](${getSourceUrl(f.config)})`;
      const subscribe = `[Subscribe](https://raw.githubusercontent.com/${REPO}/main/feeds/${f.name}.xml)`;
      const status = `✅ ${getItemLabel(f.config, f.itemCount)}`;
      lines.push(`| ${source} | ${subscribe} | ${status} |`);
    }
    lines.push("");
  }

  if (releases.length > 0) {
    lines.push("### GitHub Releases\n");
    lines.push("| Project | Feed | Status |");
    lines.push("|---------|------|--------|");
    for (const f of releases) {
      const source = `[${getSourceLabel(f.config)}](${getSourceUrl(f.config)})`;
      const subscribe = `[Subscribe](https://raw.githubusercontent.com/${REPO}/main/feeds/${f.name}.xml)`;
      const status = `✅ ${getItemLabel(f.config, f.itemCount)}`;
      lines.push(`| ${source} | ${subscribe} | ${status} |`);
    }
    lines.push("");
  }

  if (changelogs.length > 0) {
    lines.push("### Changelogs\n");
    lines.push("| Project | Feed | Status |");
    lines.push("|---------|------|--------|");
    for (const f of changelogs) {
      const source = `[${f.config.feed.title}](${getSourceUrl(f.config)})`;
      const subscribe = `[Subscribe](https://raw.githubusercontent.com/${REPO}/main/feeds/${f.name}.xml)`;
      const status = `✅ ${getItemLabel(f.config, f.itemCount)}`;
      lines.push(`| ${source} | ${subscribe} | ${status} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  const feeds = loadAllFeeds();
  console.log(`📝 Found ${feeds.length} feeds`);

  const table = generateTable(feeds);

  const readme = readFileSync(README_PATH, "utf-8");

  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    console.error("❌ README.md missing markers:");
    console.error(`   ${START_MARKER}`);
    console.error(`   ${END_MARKER}`);
    process.exit(1);
  }

  const newReadme =
    readme.slice(0, startIdx + START_MARKER.length) +
    "\n\n" +
    table +
    readme.slice(endIdx);

  if (newReadme === readme) {
    console.log("✅ README.md already up to date");
    return;
  }

  writeFileSync(README_PATH, newReadme);
  console.log("✅ README.md updated");
}

main();
