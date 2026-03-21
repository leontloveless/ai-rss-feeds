/**
 * LLM integration: HTML → FeedConfig via GitHub Models API.
 */

import type { FeedConfig } from "./types.js";

const GITHUB_MODELS_URL =
  "https://models.github.ai/inference/chat/completions";
const MODEL = "openai/gpt-4o-mini";
const MAX_RETRIES = 3;
const MAX_HTML_CHARS = 12_000; // Truncate HTML to fit GitHub Models 8K token limit

const SYSTEM_PROMPT = `You are an expert at analyzing HTML structure to extract blog article listings.

Given an HTML page of a blog index, output a JSON object matching this exact TypeScript interface:

\`\`\`typescript
interface FeedConfig {
  name: string;              // lowercase slug, e.g. "ollama"
  url: string;               // the blog URL provided
  feed: {
    title: string;           // e.g. "Ollama Blog"
    description: string;     // brief description
    language: string;        // ISO 639-1, e.g. "en"
    author?: string;         // optional
  };
  selectors: {
    articleList: string;     // CSS selector matching EACH article entry
    title: string;           // CSS selector for title RELATIVE to articleList
    date?: string;           // CSS selector for date RELATIVE to articleList
    description?: string;    // CSS selector for description RELATIVE to articleList
    link: {
      source: string;        // "attr:href" to get href from the title's <a> tag
      prefix?: string;       // base URL to prepend to relative links, e.g. "https://ollama.com"
    };
  };
  parserMode?: "css" | "json" | "changelog"; // default: "css"
  changelogExtraction?: {
    linkTemplate?: string;     // e.g., "https://github.com/org/repo/releases/tag/v{version}"
    sections?: string[];       // which ### sections to include, default: all
  };
  dateFormat?: string;        // date-fns format string if dates are in unusual format
  createdAt: string;          // ISO date string
}
\`\`\`

Rules:
1. The \`articleList\` selector should match EACH individual article/post entry.
2. \`title\` selector is RELATIVE to the articleList element.
3. For \`link.source\`, use "attr:href" — the parser will find the nearest <a> tag.
4. If URLs are relative (e.g. "/blog/post-1"), set \`link.prefix\` to the site origin.
5. Only output valid JSON. No markdown, no explanation, no code fences.
6. Set \`createdAt\` to today's date in ISO format.
7. If the page is a CHANGELOG or release notes in "Keep a Changelog" format (## headings for versions, ### for categories), set \`parserMode\` to "changelog" and provide \`changelogExtraction\` with \`linkTemplate\` if the source is a GitHub repo.`;

/**
 * Generate a FeedConfig from a blog URL's HTML using LLM.
 */
export async function generateConfig(
  url: string,
  html: string
): Promise<FeedConfig> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN not set. Required for GitHub Models API access."
    );
  }

  // Strip scripts, styles, comments, and other noise to reduce token count
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Truncate to fit in context
  const truncated =
    cleaned.length > MAX_HTML_CHARS
      ? cleaned.slice(0, MAX_HTML_CHARS) + "\n<!-- truncated -->"
      : cleaned;

  let lastError = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const userPrompt =
      attempt === 0
        ? `Analyze this blog page and output a FeedConfig JSON.\n\nURL: ${url}\n\nHTML:\n${truncated}`
        : `Previous attempt failed: ${lastError}\n\nPlease fix and try again.\n\nURL: ${url}\n\nHTML:\n${truncated}`;

    try {
      const res = await fetch(GITHUB_MODELS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 2000,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        choices: { message: { content: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from API");

      const config = JSON.parse(content) as FeedConfig;

      // Basic validation
      if (!config.name || !config.url || !config.selectors?.articleList) {
        throw new Error(
          "Invalid config: missing required fields (name, url, selectors.articleList)"
        );
      }

      return config;
    } catch (err) {
      lastError = (err as Error).message;
      console.error(
        `  ⚠️ LLM attempt ${attempt + 1}/${MAX_RETRIES} failed: ${lastError}`
      );
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  throw new Error(
    `Failed to generate config after ${MAX_RETRIES} attempts: ${lastError}`
  );
}
