
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { ragRouter } from "./rag/ragRoute.js";
import { trainerRouter } from "./rag/trainerRoute.js";
import { trainerStreamRouter } from "./rag/trainerStreamRoute.js";

// ✅ default import + correct path
import attachSttWebSocket from "../ws/sttws.js";

const app = express();
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Routes
app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/rag", ragRouter);
app.use("/api/trainer", trainerRouter);
app.use("/api/trainer", trainerStreamRouter);

// ✅ mount WS on the HTTP server
const server = http.createServer(app);
attachSttWebSocket(server, { path: "/ws/stt" });

// ✅ listen on the HTTP server

server.listen(config.port, () => {
  console.log(`✅ Backend running: http://localhost:${config.port}`);
-  // nothing here before
+  console.log(`🎧 STT WebSocket: ws://localhost:${config.port}/ws/stt`);
});
