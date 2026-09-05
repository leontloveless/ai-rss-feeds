/** Provider selection and OpenAI-compatible transport, independent of feed generation. */
export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmProvider {
  /** Return the model's JSON text. Transport errors are retried by the caller. */
  complete(messages: ChatMessage[]): Promise<string>;
}

/**
 * Build the OpenAI-compatible chat-completions endpoint from AI_BASE_URL.
 *
 * Environment examples:
 *   OpenRouter: AI_BASE_URL=https://openrouter.ai/api/v1
 *   OpenAI:     AI_BASE_URL=https://api.openai.com/v1
 *   xAI:        AI_BASE_URL=https://api.x.ai/v1
 *
 * A full .../chat/completions URL is also accepted.
 */
export function getAiConfig(): { endpoint: string; apiKey: string; model: string } {
  const apiKey = process.env.AI_API_KEY?.trim();
  const baseUrl = process.env.AI_BASE_URL?.trim();
  const model = process.env.AI_MODEL?.trim();

  // Empty workflow expressions are unset; a partial custom config is an error.
  if (!apiKey && !baseUrl && !model) {
    const token = process.env.GITHUB_TOKEN?.trim();
    if (!token) {
      throw new Error(
        "GITHUB_TOKEN not set. Set it for GitHub Models, or configure AI_API_KEY, AI_BASE_URL, and AI_MODEL."
      );
    }
    return {
      endpoint: "https://models.github.ai/inference/chat/completions",
      apiKey: token,
      model: "openai/gpt-4o-mini",
    };
  }

  const missing = [
    !apiKey && "AI_API_KEY",
    !baseUrl && "AI_BASE_URL",
    !model && "AI_MODEL",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing AI provider configuration: ${missing.join(", ")}. ` +
        "Set all three AI_* variables to use a custom provider."
    );
  }

  const normalized = baseUrl!.replace(/\/+$/, "");
  const endpoint = normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;

  return { endpoint, apiKey: apiKey!, model: model! };
}

/** GitHub Models and custom endpoints share the same wire protocol. */
export function createLlmProvider(): LlmProvider {
  const { endpoint, apiKey, model } = getAiConfig();
  return {
    async complete(messages) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
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
      return content;
    },
  };
}
