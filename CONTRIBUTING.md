# Contributing

## Requesting a New Feed

Open a [new feed issue](https://github.com/leontloveless/ai-rss-feeds/issues/new?template=new_feed.yml) with the URL and we'll handle the rest.

### What We Accept

- ✅ Well-known tech blogs, AI companies, developer tools
- ✅ GitHub repos with active releases
- ✅ Content that has genuine RSS subscription value
- ✅ Sites that don't already have RSS feeds

### What We Don't Accept

- ❌ Sites that already have RSS (we'll point you to the existing feed)
- ❌ Sites that intentionally disabled RSS — we respect the site owner's choice
- ❌ Personal blogs with no audience or obscure promotional sites
- ❌ SPA-only sites (Vue/React client-rendered without SSR) — technically unsupported
- ❌ Gambling, adult, or spam content
- ❌ Submissions primarily for SEO backlinks

### Technical Limitations

- **Static HTML only** — our parser uses Cheerio (server-side HTML parsing). JavaScript-rendered pages are not supported.
- **GitHub Models token limit** — very large pages may need manual config tuning.

## Contributing Code

PRs are welcome! The project uses TypeScript + Bun. Run `bun install` to get started.

```bash
bun run update          # Update all feeds
bun run validate        # Validate without writing
bun run add <url>       # Add a new feed
bun run readme          # Regenerate README tables
bun typecheck           # Type check
```
