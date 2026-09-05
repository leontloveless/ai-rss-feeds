import { afterEach, describe, expect, test } from "bun:test";
import { generateConfig, getAiConfig } from "./llm.js";

const ENV_KEYS = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL"] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
const originalFetch = globalThis.fetch;

function clearAiEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  globalThis.fetch = originalFetch;
});

describe("getAiConfig", () => {
  test("throws listing every missing variable", () => {
    clearAiEnv();
    expect(() => getAiConfig()).toThrow(
      "Missing AI provider configuration: AI_API_KEY, AI_BASE_URL, AI_MODEL."
    );
  });

  test("throws listing only the variables that are missing", () => {
    clearAiEnv();
    process.env.AI_API_KEY = "key";
    process.env.AI_MODEL = "some-model";
    expect(() => getAiConfig()).toThrow(
      "Missing AI provider configuration: AI_BASE_URL."
    );
  });

  test("appends /chat/completions to a bare base URL", () => {
    process.env.AI_API_KEY = "key";
    process.env.AI_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.AI_MODEL = "openrouter/free";

    expect(getAiConfig()).toEqual({
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: "key",
      model: "openrouter/free",
    });
  });

  test("trims a trailing slash before appending /chat/completions", () => {
    process.env.AI_API_KEY = "key";
    process.env.AI_BASE_URL = "https://api.openai.com/v1/";
    process.env.AI_MODEL = "gpt-4o-mini";

    expect(getAiConfig().endpoint).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
  });

  test("accepts a full chat/completions URL as-is", () => {
    process.env.AI_API_KEY = "key";
    process.env.AI_BASE_URL = "https://api.x.ai/v1/chat/completions";
    process.env.AI_MODEL = "grok-4-fast";

    expect(getAiConfig().endpoint).toBe("https://api.x.ai/v1/chat/completions");
  });
});

describe("generateConfig", () => {
  test("fails fast without calling the network when provider config is missing", async () => {
    clearAiEnv();
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as unknown as typeof fetch;

    await expect(generateConfig("https://example.com", "<html></html>")).rejects.toThrow(
      "Missing AI provider configuration"
    );
    expect(called).toBe(false);
  });

  test("posts to the configured endpoint and returns the parsed config", async () => {
    process.env.AI_API_KEY = "key";
    process.env.AI_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.AI_MODEL = "openrouter/free";

    const config = {
      name: "example",
      url: "https://example.com",
      feed: { title: "Example", description: "d", language: "en" },
      selectors: { articleList: ".post", title: "h2", link: { source: "attr:href" } },
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requestUrl = url;
      requestBody = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(config) } }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await generateConfig("https://example.com", "<html></html>");

    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(requestBody.model).toBe("openrouter/free");
    expect(result).toEqual(config);
  });
});
