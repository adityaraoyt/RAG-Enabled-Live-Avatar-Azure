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

const client = new OpenAI({
  apiKey: config.aoai.apiKey,
  baseURL: `${config.aoai.endpoint}/openai/deployments/${config.aoai.chatDeployment}`,
  defaultQuery: { "api-version": config.aoai.apiVersion },
  defaultHeaders: { "api-key": config.aoai.apiKey },
});

export async function chatCompletionStream(messages) {
  const stream = await client.chat.completions.create({
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
}

export async function embedText(text) {
  const r = await embedClient.embeddings.create({
    model: config.aoai.embeddingDeployment,
    input: text,
  });
  return r.data[0].embedding;
}

export async function chatCompletion({ system, user }) {
  const r = await chatClient.chat.completions.create({
    model: config.aoai.chatDeployment,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  });

  return r.choices?.[0]?.message?.content?.trim() || "";
}
