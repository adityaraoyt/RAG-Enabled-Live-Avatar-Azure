export function systemPrompt() {
  return `You are an enterprise training instructor.
Your responses MUST BE GROUNDED to the training material.
If the material doesn't contain the answer, ask one clarifying question.
Keep answers short and actionable.`;
}

export function userPrompt(question, passages) {
  const context = passages
    .map((p, i) => {
      const loc =
        p.page_num !== null && p.page_num !== undefined && p.page_num >= 0
          ? ` p.${p.page_num + 1}`
          : "";
      return `[#${i + 1} | ${p.doc_id}${loc}]\n${p.content}`;
    })
    .join("\n\n---\n\n");

  return `Question: ${question}

Context:
${context}

Answer in plain English.`;
}
