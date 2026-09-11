import { afterEach, describe, expect, test } from "bun:test";
import {
  deriveConfigName,
  normalizeUrl,
  parseGitHubUrl,
  shouldIncludePrereleases,
  validateFeedCandidate,
} from "./add-smart.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseGitHubUrl", () => {
  test("accepts repository, releases, and changelog URLs", () => {
    expect(parseGitHubUrl("https://github.com/deepseek-ai/deepseek-harness")).toEqual({
      owner: "deepseek-ai",
      repo: "deepseek-harness",
    });
    expect(parseGitHubUrl("https://github.com/deepseek-ai/deepseek-harness/releases")).toEqual({
      owner: "deepseek-ai",
      repo: "deepseek-harness",
    });
    expect(parseGitHubUrl("https://github.com/deepseek-ai/deepseek-harness.git")).toEqual({
      owner: "deepseek-ai",
      repo: "deepseek-harness",
    });
  });

  test("rejects lookalike hosts and incomplete URLs", () => {
    expect(parseGitHubUrl("https://github.com.evil.example/owner/repo")).toBeNull();
    expect(parseGitHubUrl("https://example.com/github.com/owner/repo")).toBeNull();
    expect(parseGitHubUrl("https://github.com/owner")).toBeNull();
  });
});

describe("shouldIncludePrereleases", () => {
  test("includes prereleases when they are the only published releases", () => {
    expect(shouldIncludePrereleases([
      { draft: false, prerelease: true },
      { draft: false, prerelease: true },
    ])).toBe(true);
  });

  test("prefers stable releases when at least one exists", () => {
    expect(shouldIncludePrereleases([
      { draft: false, prerelease: true },
      { draft: false, prerelease: false },
    ])).toBe(false);
  });

  test("does not count drafts as published releases", () => {
    expect(shouldIncludePrereleases([{ draft: true, prerelease: true }])).toBe(false);
  });
});

test("normalizes URL variants without query or fragment", () => {
  expect(normalizeUrl("https://example.com/blog/?utm_source=test#latest")).toBe(
    "https://example.com/blog"
  );
});

test("derives a stable hostname-based config name", () => {
  expect(deriveConfigName("https://www.example.com/blog")).toBe("example-com");
});

test("accepts a valid native feed when article pages block automated requests", async () => {
  const feedUrl = "https://example.com/news/rss.xml";
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    requestedUrls.push(url);

    if (url === feedUrl) {
      return new Response(`<?xml version="1.0" encoding="UTF-8" ?>
        <rss version="2.0">
          <channel>
            <title>Example News</title>
            <description>Example updates</description>
            <link>https://example.com/news/</link>
            <item>
              <title>Blocked article one</title>
              <link>https://example.com/news/blocked-article-1</link>
            </item>
            <item>
              <title>Blocked article two</title>
              <link>https://example.com/news/blocked-article-2</link>
            </item>
            <item>
              <title>Blocked article three</title>
              <link>https://example.com/news/blocked-article-3</link>
            </item>
          </channel>
        </rss>`, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    }

    return new Response("blocked", { status: 403 });
  }) as typeof fetch;

  await expect(validateFeedCandidate(feedUrl)).resolves.toMatchObject({
    url: feedUrl,
    title: "Example News",
    description: "Example updates",
  });
  expect(requestedUrls).toEqual([feedUrl]);
});
