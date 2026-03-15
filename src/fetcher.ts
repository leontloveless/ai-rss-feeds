/**
 * HTML fetcher with timeout and retry.
 */

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; ai-rss-feeds/1.0; +https://github.com/leontloveless/ai-rss-feeds)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

const API_HEADERS: Record<string, string> = {
  "User-Agent": "ai-rss-feeds/1.0",
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/**
 * Fetch JSON from GitHub API (for github-releases mode).
 */
export async function fetchGitHubAPI(
  owner: string,
  repo: string,
  limit = 50,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${Math.min(limit, 100)}`;
  const headers: Record<string, string> = { ...API_HEADERS };

  // Use GITHUB_TOKEN if available for higher rate limits
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(url, {
    headers,
    signal: controller.signal,
  });
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
  }

  return await res.text();
}

export async function fetchHTML(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT,
  retries = DEFAULT_RETRIES
): Promise<string> {
  let lastError: Error | null = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        headers: HEADERS,
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      return await res.text();
    } catch (err) {
      lastError = err as Error;
      if (i < retries) {
        const wait = Math.min(2 ** i * 1000, 5000);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message}`);
}

/**
 * Check if a URL is reachable (HEAD request, follows redirects).
 */
export async function isReachable(
  url: string,
  timeoutMs = 10_000
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "HEAD",
      headers: HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
