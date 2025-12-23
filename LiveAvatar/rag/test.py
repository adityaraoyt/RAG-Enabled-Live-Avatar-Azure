# import os
# from dotenv import load_dotenv
# from azure.core.credentials import AzureKeyCredential
# from azure.search.documents.indexes import SearchIndexClient

# load_dotenv()

# SEARCH_SERVICE = os.getenv("AZURE_SEARCH_SERVICE")
# SEARCH_KEY = os.getenv("AZURE_SEARCH_ADMIN_KEY")

# print("AZURE_SEARCH_SERVICE =", SEARCH_SERVICE)
# print("ADMIN KEY PRESENT    =", bool(SEARCH_KEY))

# client = SearchIndexClient(
#     endpoint=SEARCH_SERVICE.rstrip("/"),
#     credential=AzureKeyCredential(SEARCH_KEY),
# )

# print("\nListing indexes...")
# indexes = list(client.list_indexes())
# print("Found", len(indexes), "indexes")
# for idx in indexes:
#     print("-", idx.name)


import os, uuid
from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from embedding_client import get_embeddings

load_dotenv()
endpoint = os.getenv("AZURE_SEARCH_SERVICE")
key = os.getenv("AZURE_SEARCH_ADMIN_KEY")
index = os.getenv("AZURE_SEARCH_INDEX")

client = SearchClient(endpoint=endpoint, index_name=index, credential=AzureKeyCredential(key))

vec = get_embeddings(["hello world"])[0]

doc = {
  "id": str(uuid.uuid4()),
  "content": "hello world",
  "content_vector": vec,
  "doc_id": "smoke",
  "course_id": "smoke",
  "module_id": "smoke",
  "path": "smoke"
}

print("Uploading one doc…")
client.upload_documents([doc])
print("✅ Upload OK")
