
import "dotenv/config";

const API_URL = "https://api.anthropic.com/v1/messages";

export async function askClaude(prompt, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim();

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  if (!model) {
    throw new Error("ANTHROPIC_MODEL is not configured");
  }

  if (!prompt || !String(prompt).trim()) {
    throw new Error("Prompt is empty");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 2048,
      system:
        options.system ??
        "You are a helpful coding assistant. Answer clearly and safely.",
      messages: [
        {
          role: "user",
          content: String(prompt),
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Claude API error ${response.status}: ${
        data?.error?.message || JSON.stringify(data)
      }`
    );
  }

  const text = Array.isArray(data.content)
    ? data.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
    : "";

  if (!text) {
    throw new Error("Claude returned no text");
  }

  return text;
}