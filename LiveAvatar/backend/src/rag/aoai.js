
// aoai.js
import OpenAI from "openai";
import { config } from "../config.js";

function makeClient(deployment) {
  return new OpenAI({
    apiKey: config.aoai.apiKey,
    baseURL: `${config.aoai.endpoint}/openai/deployments/${deployment}`,
    defaultQuery: { "api-version": config.aoai.apiVersion },
    defaultHeaders: { "api-key": config.aoai.apiKey },
  });
}

const chatClient = makeClient(config.aoai.chatDeployment);
const embedClient = makeClient(config.aoai.embeddingDeployment);

export function normalizeCompletion(result) {
  // Supports legacy string returns and new object returns
  if (typeof result === "string") return { text: result, filtered: false };
  return {
    text: result?.text ?? "",
    filtered: !!result?.filtered,
    reason: result?.reason,
  };
}

export async function chatCompletion({ system, user }) {
  try {
    const r = await chatClient.chat.completions.create({
      model: config.aoai.chatDeployment,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    });
    const text = r.choices?.[0]?.message?.content?.trim() || "";
    return { text, filtered: false };
  } catch (e) {
    // Minimal 400 handling as you requested
    if (e?.status === 400) {
      return {
        text: "I'm unable to help with that request.",
        filtered: true,
        reason: e?.error?.innererror?.content_filter_result,
      };
    }
    throw e;
  }
}

export async function chatCompletionStream(messages) {
  try {
    const stream = await chatClient.chat.completions.create({
      model: config.aoai.chatDeployment,
      messages,
      temperature: 0.2,
      stream: true,
    });

    async function* iterator() {
      for await (const chunk of stream) {
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
    return iterator();

  } catch (e) {
    // Minimal 400 streaming fallback
    if (e?.status === 400) {
      async function* fallbackIterator() {
        yield "I'm unable to help with that request.";
      }
      return fallbackIterator();
    }
    throw e;
  }
}

export async function embedText(text) {
  const r = await embedClient.embeddings.create({
    model: config.aoai.embeddingDeployment,
    input: text,
  });
  return r.data[0].embedding;
}
``
