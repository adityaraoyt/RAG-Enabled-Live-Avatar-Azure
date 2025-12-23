import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 5050),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  search: {
    endpoint: process.env.AZURE_SEARCH_SERVICE,
    adminKey: process.env.AZURE_SEARCH_ADMIN_KEY,
    indexName: process.env.AZURE_SEARCH_INDEX || "training-index",
  },
  aoai: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-06-01",
    embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    chatDeployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT,
  },
};

function must(name, val) {
  if (!val) throw new Error(`Missing env var: ${name}`);
}

must("AZURE_SEARCH_SERVICE", config.search.endpoint);
must("AZURE_SEARCH_ADMIN_KEY", config.search.adminKey);
must("AZURE_OPENAI_ENDPOINT", config.aoai.endpoint);
must("AZURE_OPENAI_API_KEY", config.aoai.apiKey);
must("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", config.aoai.embeddingDeployment);
must("AZURE_OPENAI_CHAT_DEPLOYMENT", config.aoai.chatDeployment);
