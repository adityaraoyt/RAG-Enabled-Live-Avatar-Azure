import express from "express";
import { z } from "zod";
import { embedText, chatCompletion, chatCompletionStream } from "./aoai.js";
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

function buildContextQuery(history, question, maxTurns = 6) {
  const tail = history.slice(-maxTurns);
  const lines = tail
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => `${m.role.toUpperCase()}: ${m.content}`);
  lines.push(`USER: ${question}`);
  return lines.join("\n");
}

async function rewriteStandaloneQuery(history, question) {
  const tail = history
    .slice(-8)
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const system = `Rewrite the user's message into one or more standalone search queries.
- Resolve pronouns ("it", "that", "step 2")
- Preserve ALL intents if the message contains multiple parts
Return JSON only: {"queries":["...","..."]}`;

  const user = `Conversation:\n${tail}\n\nUser message:\n${question}`;

  try {
    const out = await chatCompletion({ system, user });
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed?.queries) && parsed.queries.length) return parsed.queries.slice(0, 3);
  } catch (_) {}
  // fallback: just one query
  return [question];
}

function dedupePassages(passages) {
  const seen = new Set();
  const out = [];
  for (const p of passages) {
    const key = p.content_hash || `${p.path || ""}::${(p.content || "").slice(0, 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
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
    const history = getHistory(conversationId, 20);
    const filter = buildFilter({ course_id, module_id });

    // Build multiple retrieval queries (NO guessing)
    const contextQuery = buildContextQuery(history, question, 6);
    const rewriteQueries = await rewriteStandaloneQuery(history, question);

    // Always include the raw question + context query + up to 3 rewrite queries
    const retrievalQueries = [question, contextQuery, ...rewriteQueries].slice(0, 5);

    // Embed + search each query, then fuse
    const results = [];
    for (const q of retrievalQueries) {
      const emb = await embedText(q);
      const hits = await vectorSearch({ embedding: emb, k: topK, filter });
      results.push(...hits);
    }

    // Merge + dedupe + keep a reasonable cap
    const passages = dedupePassages(results).slice(0, topK * 3);


    // Build prompt with history
    
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
