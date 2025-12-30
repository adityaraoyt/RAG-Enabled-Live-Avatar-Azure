import express from "express";
import { z } from "zod";
import { embedText, chatCompletion } from "./aoai.js";
import { vectorSearch } from "./azureSearch.js";
import { systemPrompt, userPrompt } from "./prompt.js";

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
    const embedding = await embedText(question);
    const filter = buildFilter({ course_id, module_id });

    const passages = await vectorSearch({ embedding, k: topK, filter });

    const sys = systemPrompt() + `\nStyle: ${persona}. Keep it spoken and natural.`;
    const usr =
      userPrompt(question, passages) +
      `\n\nReturn ONLY the spoken answer (no markdown, no bullet lists unless necessary).`;

    const speech = await chatCompletion({ system: sys, user: usr });

    res.json({
      speech,
      sources: passages.map((p, i) => ({
        ref: `#${i + 1}`,
        doc_id: p.doc_id,
        path: p.path,
        page_num: p.page_num,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
