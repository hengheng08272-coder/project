import "dotenv/config";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function askAI(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  if (!prompt || !String(prompt).trim()) {
    throw new Error("Prompt is empty");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openrouter/free",
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
      `OpenRouter API error ${response.status}: ${
        data?.error?.message || JSON.stringify(data)
      }`
    );
  }

  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("OpenRouter returned no text");
  }

  return text;
}