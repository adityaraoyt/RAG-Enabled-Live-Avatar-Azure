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
import attachSttWebSocket from "../ws/sttWs.js";

const app = express();
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/rag", ragRouter);
app.use("/api/trainer", trainerRouter);
app.use("/api/trainer", trainerStreamRouter);

// ✅ new: mount Azure helper endpoints
app.use("/api/azure", azureSpeechRouter);

const server = http.createServer(app);

// Optional: keep your STT WS for now
attachSttWebSocket(server, { path: "/ws/stt" });


server.listen(config.port, () => {
  console.log(`✅ Backend running: http://localhost:${config.port}`);
  console.log(`🎧 STT WebSocket: ws://localhost:${config.port}/ws/stt`);
  console.log(`🧊 Azure ICE: http://localhost:${config.port}/api/azure/ice`);
  console.log(`🔑 Azure token: http://localhost:${config.port}/api/azure/speech-token`);
});
