import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { config } from "../config.js";

const client = new SearchClient(
  config.search.endpoint.replace(/\/$/, ""),
  config.search.indexName,
  new AzureKeyCredential(config.search.adminKey)
);

export async function vectorSearch({ embedding, k = 8, filter = "" }) {
  const results = await client.search("*", {
    top: k,
    filter: filter || undefined,
    vectorSearchOptions: {
      queries: [
        {
          kind: "vector",
          vector: embedding,
          kNearestNeighborsCount: k,
          fields: ["content_vector"], // <-- matches your index
        },
      ],
    },
    select: [
      "id",
      "content",
      "doc_id",
      "course_id",
      "module_id",
      "path",
      "source_type",
      "page_num",
      "chunk_num",
      "content_hash",
    ],
  });

  const out = [];
  for await (const r of results.results) {
    out.push({ score: r.score, ...r.document });
  }
  return out;
}
