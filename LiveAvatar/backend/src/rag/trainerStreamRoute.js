import express from "express";
import { z } from "zod";
import { embedText, chatCompletion, chatCompletionStream } from "./aoai.js";
import { vectorSearch } from "./azureSearch.js";
import { systemPrompt, userPrompt } from "./prompt.js";

async function resolveQuestion({ chatCompletion, history, question }) {
  // Keep transcript short so it doesn't drift
  const transcript = history
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const system =
    "You rewrite the user's last message into a standalone, unambiguous question.\n" +
    "- Resolve references like 'this', 'that', 'it', 'they' using the conversation.\n" +
    "- Do NOT change the topic.\n" +
    "- Do NOT introduce new topics\n" +
    "- If the user asks multiple things, keep them.\n" +
    "Return ONLY the rewritten question text.";

  const user =
    `Conversation:\n${transcript}\n\n` +
    `User last message:\n${question}\n\n` +
    `Rewritten standalone question:`;

  const rewritten = await chatCompletion({ system, user });
  const out = (rewritten || "").trim();

  // Safety: if rewrite is empty, fall back to original
  return out.length >= 3 ? out : question;
}


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

  let { conversationId, question, topK = 6, course_id, module_id } = parsed.data;
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

  // Build retrieval query using recent history + current question
  const history = getHistory(conversationId, 8); // small window
  const lastUserTurns = history
    .filter(m => m.role === "user")
    .slice(-3)
    .map(m => m.content)
    .join("\n");

const retrievalQuery = lastUserTurns
  ? `Conversation so far:\n${lastUserTurns}\n\nCurrent question:\n${question}`
  : question;

// Use retrievalQuery for embedding (not just question)
const embedding = await embedText(retrievalQuery);


  // Build a compact transcript for rewriting (keep it short)
  const transcript = history
    .slice(-12)
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const rewriteSystem =
    "You rewrite the user's last message into a standalone search query. " +
    "Include any missing specifics implied by the conversation. " +
    "If the last message contains multiple questions/topics, keep them all. " +
    "Return ONLY the rewritten query text.";

  const rewrittenQuery = await chatCompletion({
    system: rewriteSystem,
    user: `Conversation so far:\n${transcript}\n\nUser's last message:\n${question}\n\nRewritten standalone query:`,
  });
  
  const resolvedQuestion = await resolveQuestion({ chatCompletion, history, question });

  
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
        content: userPrompt(resolvedQuestion, passages) +
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
    const isContentFilter =
      e?.code === "content_filter" ||
      e?.error?.code === "content_filter" ||
      (e?.message && e.message.includes("content management policy")) ||
      e?.name === "BadRequestError";

    if (isContentFilter) {
      const fallback = "I'm unable to provide an answer for that request due to content restrictions. Please try rephrasing.";
      // stream fallback as token(s)
      send("token", { token: fallback });
      pushMsg(conversationId, { role: "assistant", content: fallback });
      send("done", { ok: true, filtered: true });
      res.end();
      return;
    }

    send("error", { error: String(e?.message || e) });
    res.end();
  }
});

trainerStreamRouter.post("/respond", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let { conversationId, question, topK = 6, course_id, module_id } = parsed.data;
  if (!conversationId) conversationId = crypto.randomUUID?.() ?? String(Date.now());

  try {
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

    // Get chat completion
    try {
      const completion = await chatCompletion({
        system: sys,
        user: `Conversation so far:\n${historyWithoutLatest.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}\n\nUser's last message:\n${question}\n\n`,
        history: historyWithoutLatest,
        top_k: topK,
        temperature: 0.7,
        max_tokens: 150,
      });

      if (completion?.filtered) {
        // Non-streaming route: send JSON
        return res.json({
          success: true,
          answer: completion.text,
          filtered: true
        });
      }

      // Normal behavior: use completion.text (or stream it back as before)
      const answer = completion.text;

      // Store user and assistant messages in the conversation history
      pushMsg(conversationId, { role: "assistant", content: answer });

      // Send response
      return res.json({
        success: true,
        answer,
        sources: passages.map((p, i) => ({
          ref: `#${i + 1}`,
          doc_id: p.doc_id,
          path: p.path,
          page_num: p.page_num,
        })),
      });
    } catch (err) {
      // fallback for other unexpected errors (optional)
      console.error('Error resolving question:', err);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  } catch (err) {
    // fallback for other unexpected errors (optional)
    console.error('Error resolving question:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

function isContentFilterError(err) {
  return (
    err?.code === "content_filter" ||
    err?.error?.code === "content_filter" ||
    (err?.message && err.message.includes("content management policy")) ||
    err?.name === "BadRequestError"
  );
}

