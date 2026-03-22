# 📡 AI RSS Feeds

> AI-powered RSS feed generator for blogs that don't have one.

Many popular tech blogs don't offer RSS feeds. This project uses AI to analyze blog HTML structure, generate CSS selector configs, and produce standard RSS 2.0 feeds — updated hourly via GitHub Actions.

## 📖 Available Feeds

<!-- FEEDS_TABLE_START -->

### Blogs

| Blog | Feed | Status |
|------|------|--------|
| [Google DeepMind Blog](https://deepmind.google/discover/blog/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/deepmind-blog.xml) | ✅ 25 articles |
| [El Fintualist](https://fintualist.com/chile/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/fintualist.xml) | ✅ 450 articles |
| [Cursor Blog](https://cursor.com/blog) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/cursor-blog.xml) | ✅ 10 articles |
| [Paul Graham Essays](https://www.paulgraham.com/articles.html) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/paul-graham.xml) | ✅ 231 articles |
| [Groq News](https://groq.com/news/) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/groq-news.xml) | ✅ 24 articles |
| [Stability AI News](https://stability.ai/news) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/stability-ai.xml) | ✅ 20 articles |

### GitHub Releases

| Project | Feed | Status |
|---------|------|--------|
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/claude-code-releases.xml) | ✅ 50 releases |
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | [Subscribe](https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/openclaw-releases.xml) | ✅ 41 releases |
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
| `github-releases` | GitHub projects | GitHub Releases API (structured data) |

### Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Blog HTML   │────▶│  LLM (GPT)   │────▶│  FeedConfig  │
│  (one-time)  │     │  (one-time)  │     │   (JSON)     │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  RSS 2.0 XML │◀────│  Validator   │◀────│   Parser     │
│  (hourly)    │     │  (6 layers)  │     │ (cheerio)    │
└──────────────┘     └──────────────┘     └──────────────┘
```

1. **One-time**: LLM analyzes blog HTML → generates CSS selector config (JSON)
2. **Every hour**: Deterministic parser uses config + cheerio to extract articles
3. **Validation**: 6-layer checks (structure, dedup, dates, links, XML, regression)
4. **Output**: Standard RSS 2.0 XML committed to `feeds/`
5. **Self-heal**: If selectors break (site redesign), LLM regenerates config

> **Note**: For `github-releases` mode, step 1 is skipped — the GitHub API provides structured data directly. No LLM needed.

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
bun run update:one -- --name cursor-blog

# Validate without writing
bun run validate

# Add a new feed (requires GITHUB_TOKEN for LLM)
GITHUB_TOKEN=xxx bun run add https://example.com/blog

# Heal a broken feed (requires GITHUB_TOKEN for LLM)
GITHUB_TOKEN=xxx bun run heal cursor-blog
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
├── types.ts       → FeedConfig, Article, Snapshot types
├── fetcher.ts     → HTML/API fetching with retry
├── parser.ts      → Multi-mode parser (CSS/JSON/Changelog/GitHub)
├── validator.ts   → 6-layer validation
├── generator.ts   → Article[] → RSS 2.0 XML
├── llm.ts         → GitHub Models API integration
├── snapshot.ts    → Regression tracking
├── run-all.ts     → Batch update CLI
├── add-feed.ts    → New feed CLI
└── heal-feed.ts   → Self-healing CLI
```

## 🙏 Credits

Inspired by [Olshansk/rss-feeds](https://github.com/Olshansk/rss-feeds) — a similar project that generates RSS feeds for sites without them.

## License

MIT
