# 📡 AI RSS Feeds

> AI-powered RSS feed generator for blogs that don't have one.

Many popular tech blogs don't offer RSS feeds. This project uses AI to analyze blog HTML structure, generate CSS selector configs, and produce standard RSS 2.0 feeds — updated hourly via GitHub Actions.

## 📖 Available Feeds

<!-- FEEDS_TABLE_START -->

### Blogs (18)

| Blog | Feed | Status |
|------|------|--------|
| [Groq News](https://groq.com/news/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/groq-news.xml) | ✅ 24 articles |
| [文匯報](https://www.wenweipo.com/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/wenweipo.xml) | ✅ 13 articles |
| [Windsurf Blog](https://windsurf.com/blog) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/windsurf.xml) | ✅ 50 articles |
| [Essays](https://www.paulgraham.com/articles.html) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/paulgraham.xml) | ✅ 20 articles |
| [www.aihero.dev](https://www.aihero.dev/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/aihero-dev.xml) | ✅ 50 articles |
| [El Fintualist](https://fintualist.com/chile/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/fintualist.xml) | ✅ 20 articles |
| [blog.cloudflare.com](https://blog.cloudflare.com/tag/ai/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/cloudflare-com.xml) | ✅ 20 articles |
| [Composio Blog](https://composio.dev/blog) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/composio.xml) | ✅ 6 articles |
| [Mekong ASEAN](https://mekongasean.vn/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/mekongasean.xml) | ✅ 2 articles |
| [Stability AI News](https://stability.ai/news) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/stability-ai.xml) | ✅ 20 articles |
| [Anthropic News](https://www.anthropic.com/news) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/anthropic.xml) | ✅ 10 articles |
| [Claude Blog](https://claude.com/blog) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/claude.xml) | ✅ 15 articles |
| [Podcast AI要約｜投資・金融番組のポイント整理 — BigGo ファイナンス](https://finance.biggo.jp/podcast) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/podcast.xml) | ✅ 20 articles |
| [Cursor Blog](https://cursor.com/blog) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/cursor-blog.xml) | ✅ 19 articles |
| [Google DeepMind Blog](https://deepmind.google/discover/blog/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/deepmind-blog.xml) | ✅ 25 articles |
| [HumanLayer Blog](https://www.humanlayer.dev/blog) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/humanlayer.xml) | ✅ 9 articles |
| [文匯香港](https://www.wenweipo.com/hongkong) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/wenweipo-hongkong.xml) | ✅ 15 articles |
| [Paul Graham Essays](https://www.paulgraham.com/articles.html) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/paul-graham.xml) | ✅ 20 articles |

### External RSS (1)

| Blog | Feed | Status |
|------|------|--------|
| [booking.ai](https://booking.ai/) | [Subscribe](https://booking.ai/feed) | ✅ native RSS |

### GitHub Releases (3)

| Project | Feed | Status |
|---------|------|--------|
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/hermes-agent-releases.xml) | ✅ 22 releases |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/claude-code-releases.xml) | ✅ 50 releases |
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/openclaw-releases.xml) | ✅ 50 releases |
<!-- FEEDS_TABLE_END -->

## 🚀 Quick Start

Add any feed URL to your RSS reader:

```
https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/{name}.xml
```

## ➕ Add a Feed

1. [Open a new issue](https://github.com/leontloveless/ai-rss-feeds/issues/new?template=new_feed.yml)
2. Paste the blog URL
3. Wait ~2 minutes
4. Done! The feed is generated automatically

## 🔧 How It Works

### Parser Modes

| Mode | Use Case | Data Source |
|------|----------|-------------|
| `css` (default) | Blog index pages | Cheerio CSS selectors on HTML |
| `json` | Next.js / SPA sites | JSON extraction from `<script>` tags |
| `changelog` | Keep a Changelog files | Markdown `## version` headings |
| `rss` | Mirror an upstream RSS feed | `rssExtraction.feedUrl` parsed via rss-parser |
| `github-releases` | GitHub projects | GitHub Releases API (structured data) |

### Architecture

The defining choice: **LLM is a compiler, not an interpreter** — pay the model cost once to emit deterministic selectors, then run cheap parsers on a cron. Validation catches drift; `heal-feed` recompiles when a site redesigns.

```
                  RSS for sites that don't publish one
                              │
        ┌─────────────────────┴──────────────────────┐
        ▼                                            ▼
  call LLM every fetch                  call LLM once, cache config
  ─ slow, $$, nondet                    ─ fast, free, deterministic
  ─ breaks silently                     ─ breaks loudly → self-heal
        ✗                                            ✓  (this repo)
                                                     │
                                                     ▼
  ┌─ one-time (per blog) ─────────┐     ┌─ hourly (GitHub Actions) ──────────┐
  │                                │     │                                    │
  │  blog HTML ──▶ LLM ──▶ config  │────▶│  config + cheerio ──▶ Article[]   │
  │  (GPT analyzes DOM,            │     │           │                        │
  │   emits CSS selectors)         │     │           ▼                        │
  │                                │     │   validator (6 layers)             │
  │   configs/<name>.json          │     │   1 structure   2 dedup            │
  │   ────────────────────         │     │   3 dates       4 reachability     │
  │   { selectors, parserMode,     │     │   5 XML valid   6 regression       │
  │     feed: {title, ...} }       │     │           │                        │
  │                                │     │           ▼                        │
  └────────────▲───────────────────┘     │   generator ──▶ feeds/<name>.xml  │
               │                         │           │                        │
               │ fails validation        │           ▼                        │
               └──── heal-feed ──────────┤      git commit                    │
                     (re-run LLM)        └────────────────────────────────────┘
```

> **Note**: For `github-releases` mode, the one-time LLM step is skipped — the GitHub API provides structured data directly.

### Validation Layers

1. **Structure**: articles ≥ 1, titles non-empty & < 500 chars, valid absolute URLs
2. **Deduplication**: no duplicate links
3. **Dates**: parseable, within range (2000–tomorrow), newest-first order
4. **Link reachability**: spot-check first 3 articles (allow 1 failure)
5. **XML validity**: generated RSS parseable by rss-parser
6. **Regression**: article count ±50% warns, >30% known articles missing warns

## 🛠️ For Developers

```bash
# Install
bun install

# Update all feeds
bun run update

# Update one feed
bun run update:one cursor-blog

# Validate without writing
bun run validate

# Add a new feed (requires GITHUB_TOKEN for LLM-based blogs)
GITHUB_TOKEN=xxx bun run add https://example.com/blog

# Heal a broken feed (requires GITHUB_TOKEN for LLM)
GITHUB_TOKEN=xxx bun run heal cursor-blog

# Regenerate the feed table in this README
bun run readme
```

### Adding a GitHub Releases Feed

Create a config file in `configs/`:

```json
{
  "name": "my-project-releases",
  "url": "https://github.com/owner/repo/releases",
  "feed": {
    "title": "My Project Releases",
    "description": "Release notes for My Project",
    "language": "en",
    "author": "Owner"
  },
  "selectors": { "articleList": "", "title": "", "link": { "source": "" } },
  "parserMode": "github-releases",
  "githubReleasesExtraction": {
    "owner": "owner",
    "repo": "repo",
    "includePrerelease": false,
    "limit": 50
  },
  "createdAt": "2026-03-15T00:00:00Z"
}
```

## 📁 Project Structure

```
configs/     → Feed configs (JSON, one per blog/project)
feeds/       → Generated RSS 2.0 XML files
cache/       → Snapshots for regression tracking
src/
├── types.ts          → FeedConfig, Article, Snapshot types
├── fetcher.ts        → HTML/API fetching with retry
├── parser.ts         → Multi-mode parser (CSS/JSON/Changelog/GitHub)
├── date-enricher.ts  → Fill missing dates via <meta>/JSON-LD on detail pages
├── validator.ts      → 6-layer validation
├── generator.ts      → Article[] → RSS 2.0 XML
├── llm.ts            → GitHub Models API integration
├── snapshot.ts       → Regression tracking
├── run-all.ts        → Batch update CLI
├── add-smart.ts      → New feed CLI (auto-detects GitHub vs blog URL)
├── add-feed.ts       → Legacy LLM-only add (used by add-smart for blogs)
├── heal-feed.ts      → Self-healing CLI
└── update-readme.ts  → Regenerates the feed table in README.md
```

## 🙏 Credits

Inspired by [Olshansk/rss-feeds](https://github.com/Olshansk/rss-feeds) — a similar project that generates RSS feeds for sites without them.

## License

MIT
