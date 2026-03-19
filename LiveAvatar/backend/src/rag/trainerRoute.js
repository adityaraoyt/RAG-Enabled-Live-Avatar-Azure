import express from "express";
import { z } from "zod";
import { embedText, chatCompletion } from "./aoai.js";
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

export const trainerRouter = express.Router();

const schema = z.object({
  question: z.string().min(3),
  topK: z.number().int().min(1).max(20).optional(),
  course_id: z.string().optional(),
  module_id: z.string().optional(),
  persona: z.enum(["instructor", "coach"]).optional(),
});

function buildFilter({ course_id, module_id }) {
  const esc = (s) => s.replace(/'/g, "''");
  const parts = [];
  if (course_id) parts.push(`course_id eq '${esc(course_id)}'`);
  if (module_id) parts.push(`module_id eq '${esc(module_id)}'`);
  return parts.join(" and ");
}

trainerRouter.post("/respond", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { question, topK = 8, course_id, module_id, persona = "instructor" } = parsed.data;

  try {
    const debug_info = {
      original_query: question,
      search_query: question,
      retrieved_chunks: [],
      final_context: null,
      final_answer: null,
      timings: {},
    };

    const overallStartMs = nowMs();
    const retrievalStartMs = overallStartMs;

    const embedding = await embedText(question);
    const filter = buildFilter({ course_id, module_id });

    const passages = await vectorSearch({ embedding, k: topK, filter });

    if (DEBUG_RAG) debug_info.retrieved_chunks = passages.map(toDebugChunk);

    const sys = systemPrompt() + `\nStyle: ${persona}. Keep it spoken and natural.`;
    const usr =
      userPrompt(question, passages) +
      `\n\nReturn ONLY the spoken answer (no markdown, no bullet lists unless necessary).`;

    if (DEBUG_RAG) debug_info.final_context = { system: sys, user: truncateDebugText(usr, 12000) };

    const generationStartMs = nowMs();
    const speech = await chatCompletion({ system: sys, user: usr });

    if (DEBUG_RAG) {
      const endMs = nowMs();
      debug_info.final_answer = speech;
      debug_info.timings = {
        retrieval_ms: Math.round((generationStartMs - retrievalStartMs) * 100) / 100,
        generation_ms: Math.round((endMs - generationStartMs) * 100) / 100,
        total_ms: Math.round((endMs - overallStartMs) * 100) / 100,
      };
    }

    res.json({
      speech,
      sources: passages.map((p, i) => ({
        ref: `#${i + 1}`,
        doc_id: p.doc_id,
        path: p.path,
        page_num: p.page_num,
      })),
      ...(DEBUG_RAG ? { debug: debug_info } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
