import { afterEach, describe, expect, test } from "bun:test";
import { generateConfig } from "./llm.js";
import { createLlmProvider, getAiConfig, type ChatMessage } from "./llm-provider.js";

const ENV_KEYS = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "GITHUB_TOKEN"] as const;
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
  test("requires a GitHub token when no custom provider is configured", () => {
    clearAiEnv();
    expect(() => getAiConfig()).toThrow(
      "GITHUB_TOKEN not set."
    );
  });

  test("throws listing only the variables that are missing", () => {
    clearAiEnv();
    process.env.AI_API_KEY = "key";
    process.env.AI_MODEL = "some-model";
    process.env.GITHUB_TOKEN = "github-key";
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
      "GITHUB_TOKEN not set."
    );
    expect(called).toBe(false);
  });

  test("posts to the configured endpoint and returns the parsed config", async () => {
    process.env.GITHUB_TOKEN = "github-key-must-not-be-used";
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
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer key");
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

describe("provider compatibility", () => {
  test("empty workflow variables keep the GitHub Models request path", async () => {
    clearAiEnv();
    process.env.GITHUB_TOKEN = " github-key ";
    process.env.AI_API_KEY = "";
    process.env.AI_BASE_URL = "  ";
    process.env.AI_MODEL = "\n";
    let called = false;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      called = true;
      expect(url).toBe("https://models.github.ai/inference/chat/completions");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer github-key");
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe("openai/gpt-4o-mini");
      expect(body.response_format).toEqual({ type: "json_object" });
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    }) as unknown as typeof fetch;
    expect(await createLlmProvider().complete([{ role: "user", content: "JSON please" }])).toBe("{}");
    expect(called).toBe(true);
  });

  test("each incomplete custom configuration fails even with a GitHub token", async () => {
    const keys = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL"] as const;
    globalThis.fetch = (async () => {
      throw new Error("unexpected network call");
    }) as unknown as typeof fetch;
    for (let mask = 1; mask < 7; mask++) {
      clearAiEnv();
      process.env.GITHUB_TOKEN = "github-key";
      keys.forEach((key, index) => {
        if (mask & (1 << index)) process.env[key] = "configured";
      });
      await expect(generateConfig("https://example.com", "<p>hello</p>"))
        .rejects.toThrow("Missing AI provider configuration");
    }
  });

  test("provider HTTP errors and empty responses propagate without switching endpoints", async () => {
    clearAiEnv();
    process.env.GITHUB_TOKEN = "github-key";
    process.env.AI_API_KEY = "custom-key";
    process.env.AI_BASE_URL = "https://example.com/v1";
    process.env.AI_MODEL = "custom-model";
    const provider = createLlmProvider();
    for (const [response, error] of [
      [new Response("unavailable", { status: 503 }), "API error 503"],
      [Response.json({ choices: [] }), "Empty response from API"],
    ] as const) {
      let calls = 0;
      globalThis.fetch = (async (url: string) => {
        calls++;
        expect(url).toBe("https://example.com/v1/chat/completions");
        return response;
      }) as unknown as typeof fetch;
      await expect(provider.complete([])).rejects.toThrow(error);
      expect(calls).toBe(1);
    }
  });

  test("an injected provider retains prompt cleanup, validation, and retry feedback", async () => {
    clearAiEnv();
    const calls: ChatMessage[][] = [];
    const config = {
      name: "example", url: "https://example.com",
      feed: { title: "Example", description: "Example", language: "en" },
      selectors: { articleList: "article", title: "h2", link: { source: "attr:href" } },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const result = await generateConfig(
      config.url, "<script>noise()</script><article>Post</article>", "Old selector matched no articles",
      {
        async complete(messages) {
          calls.push(messages);
          return JSON.stringify(calls.length === 1 ? {} : config);
        },
      }
    );
    expect(result).toEqual(config);
    expect(calls).toHaveLength(2);
    expect(calls[0][0].role).toBe("system");
    expect(calls[0][1].content).toContain("Old selector matched no articles");
    expect(calls[0][1].content).not.toContain("noise()");
    expect(calls[1][1].content).toContain("Previous attempt failed: Invalid config");
    expect(calls[1][1].content).toContain("<article>Post</article>");
  });
});
