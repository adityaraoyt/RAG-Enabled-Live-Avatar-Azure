import express from "express";
import { z } from "zod";
import { embedText, chatCompletion, chatCompletionStream, normalizeCompletion } from "./aoai.js";
import { vectorSearch } from "./azureSearch.js";
import { systemPrompt, userPrompt } from "./prompt.js";

const DEBUG_RAG = process.env.DEBUG_RAG === "true" || process.env.DEBUG_RAG === "1";

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function truncateDebugText(str, maxChars) {
  const s = String(str ?? "");
  return s.length > maxChars ? s.slice(0, maxChars) + "..." : s;
}

function toDebugChunk(p) {
  return {
    source: p?.doc_id || p?.path || p?.source_type || "unknown",
    path: p?.path,
    chunk_id: p?.id ?? p?.chunk_num ?? null,
    score: typeof p?.score === "number" ? p.score : p?.score ?? null,
    page_num: p?.page_num ?? null,
    text: truncateDebugText(p?.content ?? "", 2000),
  };
}


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
  const { text } = normalizeCompletion(rewritten);
  const out = (text || "").trim();

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

  
const out = await chatCompletion({ system, user });
const { text } = normalizeCompletion(out);

try {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed?.queries) && parsed.queries.length) {
    return parsed.queries.slice(0, 3);
  }
} catch (_) {}
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
  question: z.string(),
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

  const debug_info = {
    original_query: question,
    search_query: null,
    retrieved_chunks: [],
    final_context: null,
    final_answer: null,
    timings: {},
  };

  const overallStartMs = nowMs();
  let queryRewriteStartMs = null;
  let retrievalStartMs = null;
  let retrievalEndMs = null;
  let rerankingStartMs = null;
  let rerankingEndMs = null;
  let promptAssemblyStartMs = null;
  let promptAssemblyEndMs = null;
  let generationStartMs = null;
  let generationEndMs = null;

  const round2 = (n) => Math.round(n * 100) / 100;
  const diffMs = (start, end) => {
    if (start === null || start === undefined) return null;
    if (end === null || end === undefined) return null;
    return round2(end - start);
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



  queryRewriteStartMs = nowMs();

const r = await chatCompletion({
  system: rewriteSystem,
  user: `Conversation so far:\n${transcript}\n\nUser's last message:\n${question}\n\nRewritten standalone query:`,
});
const { text: rewrittenQueryText, filtered: rewriteFiltered } = normalizeCompletion(r);
const rewrittenQuery = rewriteFiltered ? question : (rewrittenQueryText || question);


  
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

    if (DEBUG_RAG) debug_info.search_query = retrievalQueries;

    // Embed + search each query, then fuse
    retrievalStartMs = nowMs();
    const results = [];
    for (const q of retrievalQueries) {
      const emb = await embedText(q);
      const hits = await vectorSearch({ embedding: emb, k: topK, filter });
      if (DEBUG_RAG) {
        // Keep raw per-query hits too; this is extremely helpful to debug ranking/fusion failures.
        if (!debug_info.raw_search_hits) debug_info.raw_search_hits = [];
        debug_info.raw_search_hits.push({
          query: q,
          top_k: topK,
          hits: hits.slice(0, topK).map(toDebugChunk),
        });
      }
      results.push(...hits);
    }
    retrievalEndMs = nowMs();

    // Merge + dedupe + keep a reasonable cap
    const passages = dedupePassages(results).slice(0, topK * 3);

    if (DEBUG_RAG) debug_info.retrieved_chunks = passages.map(toDebugChunk);

    // Build prompt with history
    
    promptAssemblyStartMs = nowMs();
    const sys = systemPrompt() + "\nKeep it spoken and training-friendly.";

    // IMPORTANT: exclude the latest user msg in history because we add it explicitly
    const historyWithoutLatest = history.slice(0, -1);

    const userMsgContent =
      userPrompt(resolvedQuestion, passages) +
      "\n\nReturn ONLY the spoken answer. No markdown.";

    const messages = [
      { role: "system", content: sys },
      ...historyWithoutLatest,
      {
        role: "user",
        content: userMsgContent,
      },
    ];

    promptAssemblyEndMs = nowMs();

    if (DEBUG_RAG) debug_info.final_context = { system: sys, user: truncateDebugText(userMsgContent, 12000) };

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
    generationStartMs = nowMs();
    const stream = await chatCompletionStream(messages);

    let full = "";
    for await (const token of stream) {
      full += token;
      send("token", { token });
    }

    full = full.trim();
    pushMsg(conversationId, { role: "assistant", content: full });

    if (DEBUG_RAG) {
      debug_info.final_answer = full;
      generationEndMs = nowMs();

      const queryRewriteMs = diffMs(queryRewriteStartMs, retrievalStartMs);
      const retrievalMs = diffMs(retrievalStartMs, retrievalEndMs);
      const rerankingMs = diffMs(rerankingStartMs, rerankingEndMs);
      const promptAssemblyMs = diffMs(promptAssemblyStartMs, promptAssemblyEndMs);
      const llmGenerationMs = diffMs(generationStartMs, generationEndMs);
      const backendTotalMs = diffMs(overallStartMs, generationEndMs);

      debug_info.timings = {
        query_rewrite_ms: queryRewriteMs,
        retrieval_ms: retrievalMs,
        reranking_ms: rerankingMs,
        prompt_assembly_ms: promptAssemblyMs,
        llm_generation_ms: llmGenerationMs,
        backend_total_ms: backendTotalMs,

        // Back-compat keys (used by existing UI)
        generation_ms: llmGenerationMs,
        total_ms: backendTotalMs,
      };
    }

    send("done", DEBUG_RAG ? { ok: true, debug: debug_info } : { ok: true });
    res.end();
  
} catch (e) {
  if (e.status === 400) {
    const fallback = "I'm unable to help with that request.";
    send("token", { token: fallback });
    pushMsg(conversationId, { role: "assistant", content: fallback });
    if (DEBUG_RAG) {
      debug_info.final_answer = fallback;
      generationEndMs = nowMs();

      const queryRewriteMs = diffMs(queryRewriteStartMs, retrievalStartMs);
      const retrievalMs = diffMs(retrievalStartMs, retrievalEndMs);
      const rerankingMs = diffMs(rerankingStartMs, rerankingEndMs);
      const promptAssemblyMs = diffMs(promptAssemblyStartMs, promptAssemblyEndMs);
      const llmGenerationMs = diffMs(generationStartMs, generationEndMs);
      const backendTotalMs = diffMs(overallStartMs, generationEndMs);

      debug_info.timings = {
        query_rewrite_ms: queryRewriteMs,
        retrieval_ms: retrievalMs,
        reranking_ms: rerankingMs,
        prompt_assembly_ms: promptAssemblyMs,
        llm_generation_ms: llmGenerationMs,
        backend_total_ms: backendTotalMs,

        generation_ms: llmGenerationMs,
        total_ms: backendTotalMs,
      };
      send("done", { ok: true, filtered: true, debug: debug_info });
    } else {
      send("done", { ok: true, filtered: true });
    }
    return res.end();
  }

  send("error", { error: String(e.message || e) });
  return res.end();
}

});

trainerStreamRouter.post("/respond", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let { conversationId, question, topK = 6, course_id, module_id } = parsed.data;
  if (!conversationId) conversationId = crypto.randomUUID?.() ?? String(Date.now());

  const debug_info = {
    original_query: question,
    search_query: null,
    retrieved_chunks: [],
    final_context: null,
    final_answer: null,
    timings: {},
  };

  const overallStartMs = nowMs();
  const retrievalStartMs = overallStartMs;
  let generationStartMs = null;

  try {
    const history = getHistory(conversationId, 20);
    const filter = buildFilter({ course_id, module_id });

    // Build multiple retrieval queries (NO guessing)
    const contextQuery = buildContextQuery(history, question, 6);
    const rewriteQueries = await rewriteStandaloneQuery(history, question);

    // Always include the raw question + context query + up to 3 rewrite queries
    const retrievalQueries = [question, contextQuery, ...rewriteQueries].slice(0, 5);

    if (DEBUG_RAG) debug_info.search_query = retrievalQueries;

    // Embed + search each query, then fuse
    const results = [];
    for (const q of retrievalQueries) {
      const emb = await embedText(q);
      const hits = await vectorSearch({ embedding: emb, k: topK, filter });
      results.push(...hits);
    }

    // Merge + dedupe + keep a reasonable cap
    rerankingStartMs = nowMs();
    const passages = dedupePassages(results).slice(0, topK * 3);
    rerankingEndMs = nowMs();

    if (DEBUG_RAG) debug_info.retrieved_chunks = passages.map(toDebugChunk);

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
      const userForCompletion =
        `Conversation so far:\n${historyWithoutLatest
          .map(m => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n")}\n\nUser's last message:\n${question}\n\n`;

      if (DEBUG_RAG) debug_info.final_context = { system: sys, user: userForCompletion };

      generationStartMs = nowMs();
      const completion = await chatCompletion({
        system: sys,
        user: userForCompletion,
      });

      const { text: answer, filtered } = normalizeCompletion(completion);

      if (filtered) {
        if (DEBUG_RAG) {
          const endMs = nowMs();
          debug_info.final_answer = answer;
          debug_info.timings = {
            retrieval_ms: Math.round((generationStartMs - retrievalStartMs) * 100) / 100,
            generation_ms: Math.round((endMs - generationStartMs) * 100) / 100,
            total_ms: Math.round((endMs - overallStartMs) * 100) / 100,
          };
        }
        return res.json({
          success: true,
          answer,
          filtered: true,
          ...(DEBUG_RAG ? { debug: debug_info } : {}),
        });
      }


      // Store user and assistant messages in the conversation history
      pushMsg(conversationId, { role: "assistant", content: answer });

      // Send response
      const endMs = nowMs();
      if (DEBUG_RAG) {
        debug_info.final_answer = answer;
        debug_info.timings = {
          retrieval_ms: Math.round((generationStartMs - retrievalStartMs) * 100) / 100,
          generation_ms: Math.round((endMs - generationStartMs) * 100) / 100,
          total_ms: Math.round((endMs - overallStartMs) * 100) / 100,
        };
      }

      return res.json({
        success: true,
        answer,
        sources: passages.map((p, i) => ({
          ref: `#${i + 1}`,
          doc_id: p.doc_id,
          path: p.path,
          page_num: p.page_num,
        })),
        ...(DEBUG_RAG ? { debug: debug_info } : {}),
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

