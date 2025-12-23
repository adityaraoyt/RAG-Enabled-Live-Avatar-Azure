import os
from typing import List
from dotenv import load_dotenv
from openai import AzureOpenAI
import httpx

load_dotenv()

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_EMBEDDING_DEPLOYMENT = os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")

if not (AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY and AZURE_OPENAI_EMBEDDING_DEPLOYMENT):
    raise RuntimeError("Missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_EMBEDDING_DEPLOYMENT")

# Hard timeouts so it won't hang forever
http_client = httpx.Client(timeout=httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=10.0))

client = AzureOpenAI(
    azure_endpoint=AZURE_OPENAI_ENDPOINT.rstrip("/"),
    api_key=AZURE_OPENAI_API_KEY,
    api_version=AZURE_OPENAI_API_VERSION,
    http_client=http_client,
    max_retries=5,
)

def get_embeddings(texts: List[str]) -> List[List[float]]:
    resp = client.embeddings.create(
        model=AZURE_OPENAI_EMBEDDING_DEPLOYMENT,  # deployment name
        input=texts
    )
    return [d.embedding for d in resp.data]
