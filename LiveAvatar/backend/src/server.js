import dotenv from "dotenv";
dotenv.config();

import http from "http";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { ragRouter } from "./rag/ragRoute.js";
import { trainerRouter } from "./rag/trainerRoute.js";
import { trainerStreamRouter } from "./rag/trainerStreamRoute.js";
import { azureSpeechRouter } from "./rag/azureSpeechRoute.js";

// ✅ correct casing
//import attachSttWebSocket from "../ws/sttWs.js";

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/rag", ragRouter);
app.use("/api/trainer", trainerRouter);
app.use("/api/trainer", trainerStreamRouter);

// ✅ new: mount Azure helper endpoints
app.use("/api/azure", azureSpeechRouter);

const server = http.createServer(app);

// Optional: keep your STT WS for now
//attachSttWebSocket(server, { path: "/ws/stt" });


const port = Number(process.env.PORT || config.port || 5050);

server.listen(port, () => {
  console.log(`✅ Backend running on port ${port}`);
  console.log(`🎧 STT WebSocket: /ws/stt`);
  console.log(`🧊 Azure ICE: /api/azure/ice`);
  console.log(`🔑 Azure token: /api/azure/speech-token`);
});
