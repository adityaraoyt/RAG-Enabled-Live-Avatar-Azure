import os
from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    SimpleField,
    SearchableField,
    VectorSearch,
    VectorSearchProfile,
    HnswAlgorithmConfiguration,
    HnswParameters,
)

load_dotenv()

SEARCH_SERVICE = os.getenv("AZURE_SEARCH_SERVICE")
SEARCH_KEY = os.getenv("AZURE_SEARCH_ADMIN_KEY")
INDEX_NAME = os.getenv("AZURE_SEARCH_INDEX", "training-index")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "1536"))

if not SEARCH_SERVICE or not SEARCH_KEY:
    raise RuntimeError("Missing AZURE_SEARCH_SERVICE or AZURE_SEARCH_ADMIN_KEY")

client = SearchIndexClient(
    endpoint=SEARCH_SERVICE.rstrip("/"),
    credential=AzureKeyCredential(SEARCH_KEY),
)

def create_or_update_index():
    vector_search = VectorSearch(
        algorithms=[
            HnswAlgorithmConfiguration(
                name="hnsw-1",
                parameters=HnswParameters(metric="cosine", m=4, ef_construction=400, ef_search=500),
            )
        ],
        profiles=[
            VectorSearchProfile(name="vector-profile-1", algorithm_configuration_name="hnsw-1")
        ],
    )

    fields = [
        SimpleField(name="id", type=SearchFieldDataType.String, key=True),

        SearchableField(name="content", type=SearchFieldDataType.String),
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=EMBEDDING_DIM,
            vector_search_profile_name="vector-profile-1",
        ),

        # Core metadata
        SimpleField(name="doc_id", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="course_id", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="module_id", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="path", type=SearchFieldDataType.String, filterable=True),

        # Quality/debug metadata
        SimpleField(name="source_type", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="page_num", type=SearchFieldDataType.Int32, filterable=True),
        SimpleField(name="chunk_num", type=SearchFieldDataType.Int32, filterable=True),
        SimpleField(name="content_hash", type=SearchFieldDataType.String, filterable=True),
    ]

    index = SearchIndex(name=INDEX_NAME, fields=fields, vector_search=vector_search)

    print(f"Creating/updating index: {INDEX_NAME}")
    client.create_or_update_index(index)
    print("✅ Index created/updated.")

if __name__ == "__main__":
    create_or_update_index()
