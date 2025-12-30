# LiveAvatar Trainer (RAG-powered Training Assistant)

LiveAvatar Trainer is an MVP web application that combines:
- A **RAG (Retrieval-Augmented Generation) backend** using Azure AI Search + Azure OpenAI
- A **streaming chat UI** built with React
- (Future) a **live avatar interface** that will speak responses

The system allows users to ask training-related questions and receive **natural, spoken-style answers** grounded in internal training documents.

---

## High-Level Architecture

```
Browser (React Chat UI/HeyGen)
        |
        |  (SSE streaming)
        v
Node.js Backend (Express)
        |
        |  Embeddings + Chat
        v
Azure OpenAI
        |
        |  Vector Search
        v
Azure AI Search (training-index)
```

---

## Repository Structure

```
LiveAvatar/
├── backend/
│   ├── server.js
│   ├── routes/
│   │   ├── trainerRoute.js
│   │   └── trainerStreamRoute.js
│   ├── aoai.js
│   ├── azureSearch.js
│   ├── prompt.js
│   ├── .env
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Chat.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── rag/
│   ├── ingest_docs.py
│   ├── create_index.py
│   └── ingest_checkpoint.json
│
└── README.md
```

---

## Prerequisites

- **Node.js** v18+
- **npm**
- **Python 3.10+** (only needed for ingestion)
- An **Azure subscription** with:
  - Azure OpenAI
  - Azure AI Search

---

## Backend Setup (Node + Express)

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Environment variables

Create `backend/.env`:

```env
AZURE_SEARCH_SERVICE=https://<your-search>.search.windows.net
AZURE_SEARCH_ADMIN_KEY=<search-admin-key>
AZURE_SEARCH_INDEX=training-index

AZURE_OPENAI_ENDPOINT=https://<your-aoai>.openai.azure.com
AZURE_OPENAI_API_KEY=<aoai-key>
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small
```

### 3. Start backend

```bash
npm run dev
```

Backend runs at:

```
http://localhost:5050
```

---

## Frontend Setup (React Chat UI)

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Start frontend

```bash
npm run dev
```

Open:

```
http://localhost:5173
```

---

## Testing the Backend (Optional)

Non-streaming response:

```bash
curl -X POST http://localhost:5050/api/trainer/respond   -H "Content-Type: application/json"   -d '{"question":"Summarize Powers to Arrest"}'
```

Streaming response (used by UI):

```bash
curl -N -X POST http://localhost:5050/api/trainer/respond/stream   -H "Content-Type: application/json"   -d '{"question":"Summarize Powers to Arrest"}'
```

---

## Document Ingestion (RAG Setup)

> Only required when adding or updating documents.

### 1. Create the index

```bash
cd rag
python create_index.py
```

### 2. Ingest documents

```bash
python ingest_docs.py
```

---

## Daily Development Workflow

After restarting your machine:

### Terminal 1 – Backend
```bash
cd backend
npm run dev
```

### Terminal 2 – Frontend
```bash
cd frontend
npm run dev
```

Then open:

```
http://localhost:5173
```

---

## Current Features

- RAG over internal training documents
- Azure AI Search vector retrieval
- Azure OpenAI chat completions
- Server-Sent Events (token streaming)
- Conversation context preserved (in-memory)
- Clean chat UI MVP

---

## Planned Next Steps

- Persistent conversation storage
- Avatar + voice synthesis integration
- Authentication (Azure AD / Entra ID)
- Production deployment
- Improved RAG quality

---

## License

Internal / MVP use only
