import express from "express";
import { z } from "zod";
import { embedText, chatCompletion } from "./aoai.js";
import { vectorSearch } from "./azureSearch.js";
import { systemPrompt, userPrompt } from "./prompt.js";

export const ragRouter = express.Router();

const schema = z.object({
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

ragRouter.post("/answer", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { question, topK = 8, course_id, module_id } = parsed.data;

  try {
    const embedding = await embedText(question);
    const filter = buildFilter({ course_id, module_id });

    const passages = await vectorSearch({ embedding, k: topK, filter });

    const answer = await chatCompletion({
      system: systemPrompt(),
      user: userPrompt(question, passages),
    });

    res.json({
      answer,
      citations: passages.map((p, i) => ({
        ref: `#${i + 1}`,
        doc_id: p.doc_id,
        path: p.path,
        page_num: p.page_num,
        course_id: p.course_id,
        module_id: p.module_id,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
