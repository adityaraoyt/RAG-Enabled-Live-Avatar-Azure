import express from "express";
import { z } from "zod";
import { embedText, chatCompletionStream } from "./aoai.js";
import { vectorSearch } from "./azureSearch.js";
import { systemPrompt, userPrompt } from "./prompt.js";

// OPTIONAL: in-memory conversation store (simple MVP)
const conversations = new Map(); // conversationId -> [{role, content}]

function getHistory(conversationId, limit = 20) {
  const h = conversations.get(conversationId) || [];
  return h.slice(-limit);
}

function pushMsg(conversationId, msg) {
  const h = conversations.get(conversationId) || [];
  h.push(msg);
  conversations.set(conversationId, h);
}

export const trainerStreamRouter = express.Router();

const schema = z.object({
  conversationId: z.string().min(4).optional(),
  question: z.string().min(3),
  topK: z.number().int().min(1).max(20).optional(),
  course_id: z.string().optional(),
  module_id: z.string().optional(),
});

function buildFilter({ course_id, module_id }) {
  const esc = (s) => s.replace(/'/g, "''");
  const parts = [];
  if (course_id) parts.push(`course_id eq '${esc(course_id)}'`);
  if (module_id) parts.push(`module_id eq '${esc(module_id)}'`);
  return parts.join(" and ");
}

trainerStreamRouter.post("/respond/stream", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let { conversationId, question, topK = 8, course_id, module_id } = parsed.data;
  if (!conversationId) conversationId = crypto.randomUUID?.() ?? String(Date.now());

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Store user message
    pushMsg(conversationId, { role: "user", content: question });

    // Retrieve
    const embedding = await embedText(question);
    const filter = buildFilter({ course_id, module_id });
    const passages = await vectorSearch({ embedding, k: topK, filter });

    // Build prompt with history
    const history = getHistory(conversationId, 20);
    const sys = systemPrompt() + "\nKeep it spoken and training-friendly.";

    // IMPORTANT: exclude the latest user msg in history because we add it explicitly
    const historyWithoutLatest = history.slice(0, -1);

    const messages = [
      { role: "system", content: sys },
      ...historyWithoutLatest,
      {
        role: "user",
        content: userPrompt(question, passages) +
          "\n\nReturn ONLY the spoken answer. No markdown.",
      },
    ];

    send("meta", {
      conversationId,
      sources: passages.map((p, i) => ({
        ref: `#${i + 1}`,
        doc_id: p.doc_id,
        path: p.path,
        page_num: p.page_num,
      })),
    });

    // Stream tokens
    const stream = await chatCompletionStream(messages);

    let full = "";
    for await (const token of stream) {
      full += token;
      send("token", { token });
    }

    full = full.trim();
    pushMsg(conversationId, { role: "assistant", content: full });

    send("done", { ok: true });
    res.end();
  } catch (e) {
    send("error", { error: String(e?.message || e) });
    res.end();
  }
});
