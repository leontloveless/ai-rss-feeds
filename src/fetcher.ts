/**
 * HTML fetcher with timeout and retry.
 */

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; ai-rss-feeds/1.0; +https://github.com/leontloveless/ai-rss-feeds)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

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
