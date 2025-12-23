export function systemPrompt() {
  return `You are an enterprise training instructor.
Use ONLY the provided context.
If the context doesn't contain the answer, say you don't know and ask a clarifying question.
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

Answer in plain English. Cite sources using [#1], [#2] at the end of sentences where you used context.`;
}
